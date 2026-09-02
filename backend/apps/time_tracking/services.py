from __future__ import annotations

from datetime import date, datetime, timedelta

from django.db import IntegrityError, transaction
from django.db.models import Case, F, IntegerField, Sum, Value, When
from django.db.models.functions import Coalesce, Now
from django.utils import timezone

from apps.projects.models import Project
from apps.routines.models import RoutineItem
from apps.tasks.models import Task
from apps.time_tracking.models import SleepSession, TimeEntry
from common.actors import Actor
from common.events import DomainEvent, EventName, emit
from common.exceptions import Conflict, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import can_view_object
from common.tz import day_bounds, today_for

MAX_ENTRY_SECONDS = 24 * 3600


def running_entry(user) -> TimeEntry | None:
    return TimeEntry.objects.running().filter(owner=user).select_related("task", "project", "routine_item").first()


def running_sleep(user) -> SleepSession | None:
    return SleepSession.objects.filter(owner=user, ended_at__isnull=True).first()


def _resolve_targets(user, *, task_id: int | None, project_id: int | None, routine_item_id: int | None):
    task = project = routine_item = None
    if task_id is not None:
        task = Task.objects.select_related("project").filter(pk=task_id).first()
        if task is None or not can_view_object(
            user, owner_id=task.owner_id, project=task.project, visibility=task.visibility
        ):
            raise NotFound("Task not found.")
        project = task.project
    if project_id is not None and project is None:
        project = Project.objects.filter(pk=project_id).first()
        if project is None or not can_view_object(
            user, owner_id=project.owner_id, project=project, visibility=Visibility.GROUP
        ):
            raise NotFound("Project not found.")
    if routine_item_id is not None:
        routine_item = RoutineItem.objects.filter(pk=routine_item_id, routine__owner=user).first()
        if routine_item is None:
            raise NotFound("Routine item not found.")
    return task, project, routine_item


def _category_for(task, project, routine_item, requested: str | None) -> str:
    if requested in dict(TimeEntry.Category.choices):
        return requested
    if routine_item is not None:
        return TimeEntry.Category.BUSINESS if routine_item.counts_as_business else TimeEntry.Category.PERSONAL
    if task is not None:
        return TimeEntry.Category.BUSINESS if task.kind == Task.Kind.BUSINESS else TimeEntry.Category.PERSONAL
    if project is not None:
        return TimeEntry.Category.BUSINESS
    return TimeEntry.Category.BUSINESS


def _payload(entry: TimeEntry) -> dict:
    return {
        "entry_id": entry.pk,
        "task_id": entry.task_id,
        "task_title": entry.task.title if entry.task_id else "",
        "project_id": entry.project_id,
        "category": entry.category,
        "duration_seconds": entry.duration_seconds,
    }


def _emit(entry: TimeEntry, name: str, actor: Actor) -> None:
    visibility = Visibility.PRIVATE
    if entry.task_id:
        visibility = entry.task.visibility
    emit(
        DomainEvent(
            name=name,
            actor=actor,
            target_type="time_entry",
            target_id=entry.pk,
            owner_user_id=entry.owner_id,
            project_id=entry.project_id if visibility != Visibility.PRIVATE else None,
            visibility=visibility,
            payload=_payload(entry),
        )
    )


@transaction.atomic
def start_timer(
    actor: Actor,
    *,
    task_id: int | None = None,
    project_id: int | None = None,
    routine_item_id: int | None = None,
    category: str | None = None,
    note: str = "",
    stop_running: bool = True,
    resumed_from_id: int | None = None,
) -> TimeEntry:
    """Start a new authoritative timer. By default any running timer is stopped first (single-timer rule)."""
    user = actor.user
    task, project, routine_item = _resolve_targets(
        user, task_id=task_id, project_id=project_id, routine_item_id=routine_item_id
    )
    current = TimeEntry.objects.select_for_update().running().filter(owner=user).first()
    if current is not None:
        if not stop_running:
            raise Conflict("A timer is already running.", code="timer_running")
        _finish(current, actor)

    entry = TimeEntry(
        owner=user,
        category=_category_for(task, project, routine_item, category),
        task=task,
        project=project,
        routine_item=routine_item,
        started_at=timezone.now(),
        note=(note or "")[:300],
        source=actor.source,
        resumed_from_id=resumed_from_id,
    )
    try:
        entry.save()
    except IntegrityError as exc:  # racing start from two clients
        raise Conflict("A timer is already running.", code="timer_running") from exc
    entry = TimeEntry.objects.select_related("task", "project", "routine_item").get(pk=entry.pk)
    _emit(entry, EventName.TIMER_STARTED, actor)
    return entry


def _finish(entry: TimeEntry, actor: Actor, ended_at: datetime | None = None) -> TimeEntry:
    ended_at = ended_at or timezone.now()
    seconds = max(1, int((ended_at - entry.started_at).total_seconds()))
    if seconds > MAX_ENTRY_SECONDS:
        # Forgotten timer: clamp to 24 h so analytics stay sane.
        seconds = MAX_ENTRY_SECONDS
        ended_at = entry.started_at + timedelta(seconds=seconds)
    entry.ended_at = ended_at
    entry.duration_seconds = seconds
    entry.save(update_fields=["ended_at", "duration_seconds", "updated_at"])
    _emit(entry, EventName.TIMER_STOPPED, actor)
    return entry


@transaction.atomic
def stop_timer(actor: Actor, entry_id: int | None = None) -> TimeEntry:
    qs = TimeEntry.objects.select_for_update(of=("self",)).running().filter(owner=actor.user)
    locked = qs.filter(pk=entry_id).first() if entry_id else qs.first()
    if locked is None:
        raise NotFound("No running timer.")
    entry = TimeEntry.objects.select_related("task", "project").get(pk=locked.pk)
    return _finish(entry, actor)


@transaction.atomic
def resume_timer(actor: Actor, entry_id: int) -> TimeEntry:
    previous = (
        TimeEntry.objects.select_related("task", "project", "routine_item")
        .filter(pk=entry_id, owner=actor.user)
        .first()
    )
    if previous is None:
        raise NotFound("Time entry not found.")
    return start_timer(
        actor,
        task_id=previous.task_id,
        project_id=previous.project_id,
        routine_item_id=previous.routine_item_id,
        category=previous.category,
        note=previous.note,
        resumed_from_id=previous.pk,
    )


@transaction.atomic
def add_manual_entry(
    actor: Actor,
    *,
    started_at: datetime,
    ended_at: datetime,
    task_id: int | None = None,
    project_id: int | None = None,
    routine_item_id: int | None = None,
    category: str | None = None,
    note: str = "",
) -> TimeEntry:
    if ended_at <= started_at:
        raise ValidationFailed("End must be after start.", fields={"ended_at": ["Must be after start."]})
    if ended_at > timezone.now() + timedelta(minutes=5):
        raise ValidationFailed("Cannot log time in the future.", fields={"ended_at": ["In the future."]})
    if (ended_at - started_at).total_seconds() > MAX_ENTRY_SECONDS:
        raise ValidationFailed("An entry cannot exceed 24 hours.", fields={"ended_at": ["Too long."]})
    task, project, routine_item = _resolve_targets(
        actor.user, task_id=task_id, project_id=project_id, routine_item_id=routine_item_id
    )
    entry = TimeEntry.objects.create(
        owner=actor.user,
        category=_category_for(task, project, routine_item, category),
        task=task,
        project=project,
        routine_item=routine_item,
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=int((ended_at - started_at).total_seconds()),
        note=(note or "")[:300],
        is_manual=True,
        source=actor.source,
    )
    _emit(entry, EventName.TIMER_STOPPED, actor)
    return entry


@transaction.atomic
def update_entry(actor: Actor, entry_id: int, **fields) -> TimeEntry:
    entry = TimeEntry.objects.select_for_update().filter(pk=entry_id, owner=actor.user).first()
    if entry is None:
        raise NotFound("Time entry not found.")
    if entry.is_running:
        raise Conflict("Stop the timer before editing it.", code="timer_running")
    started_at = fields.get("started_at", entry.started_at)
    ended_at = fields.get("ended_at", entry.ended_at)
    if ended_at <= started_at:
        raise ValidationFailed("End must be after start.", fields={"ended_at": ["Must be after start."]})
    if (ended_at - started_at).total_seconds() > MAX_ENTRY_SECONDS:
        raise ValidationFailed("An entry cannot exceed 24 hours.", fields={"ended_at": ["Too long."]})
    entry.started_at = started_at
    entry.ended_at = ended_at
    entry.duration_seconds = int((ended_at - started_at).total_seconds())
    if "note" in fields:
        entry.note = (fields["note"] or "")[:300]
    if "category" in fields and fields["category"] in dict(TimeEntry.Category.choices):
        entry.category = fields["category"]
    if any(k in fields for k in ("task_id", "project_id", "routine_item_id")):
        task, project, routine_item = _resolve_targets(
            actor.user,
            task_id=fields.get("task_id", entry.task_id),
            project_id=fields.get("project_id", entry.project_id),
            routine_item_id=fields.get("routine_item_id", entry.routine_item_id),
        )
        entry.task, entry.project, entry.routine_item = task, project, routine_item
    entry.save()
    return entry


@transaction.atomic
def delete_entry(actor: Actor, entry_id: int) -> None:
    entry = TimeEntry.objects.filter(pk=entry_id, owner=actor.user).first()
    if entry is None:
        raise NotFound("Time entry not found.")
    entry.delete()


# ---------------------------------------------------------------------------------- totals


def live_seconds_expression():
    """Seconds including the running entry, evaluated in the database."""
    from django.db.models import DurationField, ExpressionWrapper
    from django.db.models.functions import Extract

    running = ExpressionWrapper(Now() - F("started_at"), output_field=DurationField())
    return Case(
        When(ended_at__isnull=True, then=Extract(running, "epoch")),
        default=F("duration_seconds"),
        output_field=IntegerField(),
    )


def totals_for_window(user, start: datetime, end: datetime) -> dict:
    """Aggregated seconds in [start, end), clipping entries to the window boundaries."""
    entries = TimeEntry.objects.filter(owner=user).in_window(start, end).select_related("task", "project")
    now = timezone.now()
    totals = {"business": 0, "personal": 0, "total": 0, "by_project": {}, "by_task": {}, "by_routine_item": {}}
    for entry in entries:
        entry_end = entry.ended_at or now
        clipped = (min(entry_end, end) - max(entry.started_at, start)).total_seconds()
        if clipped <= 0:
            continue
        seconds = int(clipped)
        totals[entry.category] += seconds
        totals["total"] += seconds
        if entry.project_id:
            totals["by_project"][entry.project_id] = totals["by_project"].get(entry.project_id, 0) + seconds
        if entry.task_id:
            totals["by_task"][entry.task_id] = totals["by_task"].get(entry.task_id, 0) + seconds
        if entry.routine_item_id:
            totals["by_routine_item"][entry.routine_item_id] = (
                totals["by_routine_item"].get(entry.routine_item_id, 0) + seconds
            )
    return totals


def today_totals(user) -> dict:
    start, end = day_bounds(user)
    return totals_for_window(user, start, end)


def tracked_seconds_by_routine_item(user, day: date | None = None) -> dict[int, int]:
    start, end = day_bounds(user, day or today_for(user))
    return totals_for_window(user, start, end)["by_routine_item"]


def total_seconds_for_project(project_id: int) -> int:
    return (
        TimeEntry.objects.filter(project_id=project_id)
        .aggregate(total=Coalesce(Sum(live_seconds_expression()), Value(0)))
        .get("total", 0)
        or 0
    )


# ---------------------------------------------------------------------------------- sleep


@transaction.atomic
def start_sleep(actor: Actor) -> SleepSession:
    if SleepSession.objects.filter(owner=actor.user, ended_at__isnull=True).exists():
        raise Conflict("Sleep is already being tracked.", code="sleep_running")
    running = TimeEntry.objects.select_for_update().running().filter(owner=actor.user).first()
    if running is not None:
        _finish(running, actor)
    try:
        return SleepSession.objects.create(owner=actor.user, started_at=timezone.now(), source=actor.source)
    except IntegrityError as exc:
        raise Conflict("Sleep is already being tracked.", code="sleep_running") from exc


@transaction.atomic
def stop_sleep(actor: Actor) -> SleepSession:
    session = SleepSession.objects.select_for_update().filter(owner=actor.user, ended_at__isnull=True).first()
    if session is None:
        raise NotFound("No sleep session running.")
    session.ended_at = timezone.now()
    session.duration_seconds = min(int((session.ended_at - session.started_at).total_seconds()), MAX_ENTRY_SECONDS)
    session.save(update_fields=["ended_at", "duration_seconds", "updated_at"])
    return session


@transaction.atomic
def add_manual_sleep(actor: Actor, *, started_at: datetime, ended_at: datetime, note: str = "") -> SleepSession:
    if ended_at <= started_at:
        raise ValidationFailed("End must be after start.", fields={"ended_at": ["Must be after start."]})
    if (ended_at - started_at).total_seconds() > MAX_ENTRY_SECONDS:
        raise ValidationFailed("A sleep session cannot exceed 24 hours.", fields={"ended_at": ["Too long."]})
    return SleepSession.objects.create(
        owner=actor.user,
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=int((ended_at - started_at).total_seconds()),
        is_manual=True,
        note=(note or "")[:200],
        source=actor.source,
    )


@transaction.atomic
def delete_sleep(actor: Actor, session_id: int) -> None:
    session = SleepSession.objects.filter(pk=session_id, owner=actor.user).first()
    if session is None:
        raise NotFound("Sleep session not found.")
    session.delete()


def sleep_seconds_for_window(user, start: datetime, end: datetime) -> int:
    total = 0
    now = timezone.now()
    for session in SleepSession.objects.filter(owner=user, started_at__lt=end).exclude(ended_at__lt=start):
        session_end = session.ended_at or now
        clipped = (min(session_end, end) - max(session.started_at, start)).total_seconds()
        if clipped > 0:
            total += int(clipped)
    return total
