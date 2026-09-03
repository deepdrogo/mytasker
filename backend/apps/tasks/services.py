# MyTasker — task service layer.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""Task domain service. All task mutations funnel through here."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

from dateutil.rrule import DAILY, FR, MO, MONTHLY, SA, SU, TH, TU, WE, WEEKLY, rrule
from django.contrib.postgres.search import SearchVector
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.projects.models import Project
from apps.tasks.models import RecurrenceRule, Reminder, Task
from common.actors import Actor, ActorKind
from common.events import DomainEvent, EventName, emit
from common.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import Capability, can_edit_object, can_view_object, project_access

WEEKDAY_MAP = {0: MO, 1: TU, 2: WE, 3: TH, 4: FR, 5: SA, 6: SU}

EDITABLE_FIELDS = {
    "title",
    "description",
    "notes",
    "priority",
    "status",
    "start_at",
    "due_at",
    "due_has_time",
    "reminder_at",
    "estimated_minutes",
    "tags",
    "sort_order",
    "visibility",
    "kind",
}


# --------------------------------------------------------------------------- helpers


def get_task_for_user(task_id: int, user, *, for_update: bool = False) -> Task:
    qs = Task.objects.select_related("project", "owner", "assignee", "parent")
    if for_update:
        qs = qs.select_for_update(of=("self",))
    task = qs.filter(pk=task_id).first()
    if task is None:
        raise NotFound("Task not found.")
    if not can_view_object(user, owner_id=task.owner_id, project=task.project, visibility=task.visibility):
        raise NotFound("Task not found.")
    return task


def assert_can_edit(task: Task, user, capability: str = Capability.EDIT_TASK) -> None:
    if not can_edit_object(
        user, owner_id=task.owner_id, project=task.project, visibility=task.visibility, capability=capability
    ):
        raise Forbidden("You cannot modify this task.")


def _resolve_project(project_id: int | None, user, *, capability: str = Capability.CREATE_TASK) -> Project | None:
    if project_id is None:
        return None
    project = Project.objects.filter(pk=project_id).first()
    if project is None:
        raise ValidationFailed("Project not found.", fields={"project": ["Unknown project."]})
    access = project_access(user, project)
    if not access.can(capability):
        raise Forbidden("You cannot add tasks to this project.")
    return project


def _resolve_origin(requested: str | None, project: Project | None) -> str:
    """
    Explicit origin wins; otherwise a task created with a project comes from that project's page
    and stays out of the Business list, while a project-less task belongs to a list.
    """
    if requested in dict(Task.Origin.choices):
        return requested
    return Task.Origin.PROJECT if project is not None else Task.Origin.LIST


def _normalise_visibility(project: Project | None, requested: str | None, owner_is_actor: bool) -> str:
    """Private visibility only makes sense for the owner inside private / group_plus projects."""
    if project is None:
        return Visibility.PRIVATE
    if requested == Visibility.PRIVATE and owner_is_actor and project.supports_private_items:
        return Visibility.PRIVATE
    if project.mode == Project.Mode.PRIVATE:
        return Visibility.PRIVATE
    return Visibility.GROUP


def _update_search_vector(task: Task) -> None:
    Task.all_objects.filter(pk=task.pk).update(
        search_vector=SearchVector("title", weight="A") + SearchVector("description", weight="B")
    )


def _sync_reminder(task: Task) -> None:
    Reminder.objects.filter(task=task, status=Reminder.Status.PENDING).update(status=Reminder.Status.CANCELLED)
    if task.reminder_at and task.status not in (Task.Status.DONE, Task.Status.CANCELLED):
        Reminder.objects.create(
            user=task.owner,
            task=task,
            remind_at=task.reminder_at,
            message=task.title[:300],
        )
        Task.all_objects.filter(pk=task.pk).update(reminder_sent_at=None)


def _event_project_fields(task: Task) -> dict[str, Any]:
    return {
        "project_id": task.project_id,
        "visibility": task.visibility if task.project_id else Visibility.PRIVATE,
        "owner_user_id": task.owner_id,
    }


def _payload(task: Task, **extra) -> dict[str, Any]:
    data = {
        "task_id": task.pk,
        "title": task.title,
        "kind": task.kind,
        "priority": task.priority,
        "status": task.status,
        "project_name": task.project.name if task.project_id else "",
        "is_subtask": task.is_subtask,
        "parent_id": task.parent_id,
        "parent_title": task.parent.title if task.parent_id and task.parent else "",
    }
    data.update(extra)
    return data


# --------------------------------------------------------------------------- create


@transaction.atomic
def create_task(
    actor: Actor,
    *,
    title: str,
    kind: str = Task.Kind.PERSONAL,
    project_id: int | None = None,
    parent_id: int | None = None,
    assignee_id: int | None = None,
    visibility: str | None = None,
    recurrence: dict | None = None,
    owner=None,
    origin: str | None = None,
    **fields,
) -> Task:
    user = actor.user
    if user is None:
        raise Forbidden("Authentication required.")

    title = (title or "").strip()
    if not title:
        raise ValidationFailed("Title is required.", fields={"title": ["This field is required."]})

    parent: Task | None = None
    if parent_id is not None:
        parent = get_task_for_user(parent_id, user)
        if parent.is_subtask:
            raise ValidationFailed("Subtasks cannot have their own subtasks.", fields={"parent": ["Too deep."]})
        assert_can_edit(parent, user, Capability.CREATE_TASK)
        project = parent.project
        kind = parent.kind
        task_owner = parent.owner
        resolved_visibility = parent.visibility
        resolved_origin = parent.origin
    else:
        project = _resolve_project(project_id, user)
        task_owner = owner or (project.owner if project is not None else user)
        if project is not None and kind == Task.Kind.PERSONAL:
            kind = Task.Kind.BUSINESS
        resolved_visibility = _normalise_visibility(project, visibility, task_owner == user)
        resolved_origin = _resolve_origin(origin, project)

    payload = {key: value for key, value in fields.items() if key in EDITABLE_FIELDS}
    payload.pop("kind", None)
    payload.pop("visibility", None)

    rule = _build_recurrence(recurrence) if recurrence else None

    task = Task.objects.create(
        owner=task_owner,
        created_by=user,
        assignee_id=assignee_id,
        project=project,
        parent=parent,
        depth=1 if parent is not None else 0,
        kind=kind,
        origin=resolved_origin,
        title=title,
        visibility=resolved_visibility,
        recurrence=rule,
        **payload,
    )
    _update_search_vector(task)
    _sync_reminder(task)

    emit(
        DomainEvent(
            name=EventName.SUBTASK_CREATED if parent is not None else EventName.TASK_CREATED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            payload=_payload(task),
            **_event_project_fields(task),
        )
    )
    return task


def _build_recurrence(data: dict) -> RecurrenceRule:
    freq = data.get("freq")
    if freq not in dict(RecurrenceRule.Freq.choices):
        raise ValidationFailed("Unsupported recurrence.", fields={"recurrence": ["Unknown frequency."]})
    return RecurrenceRule.objects.create(
        freq=freq,
        interval=max(1, int(data.get("interval") or 1)),
        byweekday=[int(d) for d in (data.get("byweekday") or []) if 0 <= int(d) <= 6],
        bymonthday=data.get("bymonthday"),
        until=data.get("until"),
        count=data.get("count"),
    )


# --------------------------------------------------------------------------- update


@transaction.atomic
def update_task(actor: Actor, task_id: int, *, expected_version: int | None = None, **fields) -> Task:
    user = actor.user
    task = get_task_for_user(task_id, user, for_update=True)
    assert_can_edit(task, user)

    if expected_version is not None and expected_version != task.version:
        raise Conflict("This task was changed elsewhere. Reload to see the latest version.", code="version_conflict")

    previous_due = task.due_at
    previous_assignee = task.assignee_id
    changed: list[str] = []

    if "project_id" in fields:
        project = _resolve_project(fields.pop("project_id"), user)
        if task.is_subtask:
            raise ValidationFailed("Move the parent task instead.", fields={"project": ["Subtask follows parent."]})
        task.project = project
        task.kind = Task.Kind.BUSINESS if project is not None else task.kind
        task.visibility = _normalise_visibility(project, task.visibility, task.owner_id == user.pk)
        changed += ["project", "kind", "visibility"]
        # A project-only task detached from its project must land back in a list, or it would vanish.
        if project is None and task.origin == Task.Origin.PROJECT:
            task.origin = Task.Origin.LIST
            changed.append("origin")

    if "assignee_id" in fields:
        assignee_id = fields.pop("assignee_id")
        if assignee_id is not None and task.project_id is None:
            raise ValidationFailed("Only project tasks can be assigned.", fields={"assignee": ["No project."]})
        task.assignee_id = assignee_id
        changed.append("assignee")

    if "recurrence" in fields:
        recurrence = fields.pop("recurrence")
        task.recurrence = _build_recurrence(recurrence) if recurrence else None
        changed.append("recurrence")

    if "visibility" in fields:
        requested = fields.pop("visibility")
        if task.owner_id != user.pk:
            raise Forbidden("Only the owner can change visibility.")
        task.visibility = _normalise_visibility(task.project, requested, True)
        if "visibility" not in changed:
            changed.append("visibility")

    for key, value in fields.items():
        if key not in EDITABLE_FIELDS or key in {"status"}:
            continue
        if key == "title":
            value = (value or "").strip()
            if not value:
                raise ValidationFailed("Title is required.", fields={"title": ["This field is required."]})
        setattr(task, key, value)
        changed.append(key)

    if not changed:
        return task

    task.version = F("version") + 1
    task.save(update_fields=[*set(changed), "version", "updated_at"])
    task.refresh_from_db()

    if "title" in changed or "description" in changed:
        _update_search_vector(task)
    if "reminder_at" in changed:
        _sync_reminder(task)

    deadline_changed = "due_at" in changed and previous_due != task.due_at
    assignment_changed = "assignee" in changed and previous_assignee != task.assignee_id

    if deadline_changed:
        emit(
            DomainEvent(
                name=EventName.TASK_DEADLINE_CHANGED,
                actor=actor,
                target_type="task",
                target_id=task.pk,
                payload=_payload(
                    task,
                    previous_due=previous_due.isoformat() if previous_due else "",
                    new_due=task.due_at.isoformat() if task.due_at else "",
                ),
                **_event_project_fields(task),
            )
        )
    if assignment_changed:
        emit(
            DomainEvent(
                name=EventName.TASK_ASSIGNED,
                actor=actor,
                target_type="task",
                target_id=task.pk,
                payload=_payload(
                    task, assignee=task.assignee.display_name if task.assignee_id and task.assignee else ""
                ),
                **_event_project_fields(task),
            )
        )
    if not deadline_changed and not assignment_changed:
        emit(
            DomainEvent(
                name=EventName.TASK_UPDATED,
                actor=actor,
                target_type="task",
                target_id=task.pk,
                payload=_payload(task, fields=sorted(set(changed))),
                **_event_project_fields(task),
            )
        )
    return task


# --------------------------------------------------------------------------- complete


@transaction.atomic
def complete_task(actor: Actor, task_id: int, *, cascade_subtasks: bool = True) -> Task:
    user = actor.user
    task = get_task_for_user(task_id, user, for_update=True)
    assert_can_edit(task, user, Capability.COMPLETE_TASK)
    return mark_complete(task, actor, cascade_subtasks=cascade_subtasks)


def mark_complete(task: Task, actor: Actor, *, cascade_subtasks: bool = True) -> Task:
    """Complete an already-authorised, locked task. Shared by the user API and the guest share flow."""
    if task.status == Task.Status.DONE:
        return task

    now = timezone.now()
    task.status = Task.Status.DONE
    task.completed_at = now
    task.completed_by = actor.user if actor.kind != ActorKind.GUEST else None
    task.completed_by_guest = actor.guest_session
    task.completion_source = actor.source
    task.version = F("version") + 1
    task.save(
        update_fields=[
            "status",
            "completed_at",
            "completed_by",
            "completed_by_guest",
            "completion_source",
            "version",
            "updated_at",
        ]
    )
    task.refresh_from_db()

    if cascade_subtasks and not task.is_subtask:
        Task.objects.filter(parent=task).exclude(status=Task.Status.DONE).update(
            status=Task.Status.DONE,
            completed_at=now,
            completed_by=task.completed_by,
            completion_source=actor.source,
        )

    Reminder.objects.filter(task=task, status=Reminder.Status.PENDING).update(status=Reminder.Status.CANCELLED)
    _spawn_next_recurrence(task, actor)

    emit(
        DomainEvent(
            name=EventName.SUBTASK_COMPLETED if task.is_subtask else EventName.TASK_COMPLETED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            payload=_payload(task, completed_at=now.isoformat()),
            **_event_project_fields(task),
        )
    )
    return task


@transaction.atomic
def reopen_task(actor: Actor, task_id: int) -> Task:
    user = actor.user
    task = get_task_for_user(task_id, user, for_update=True)
    assert_can_edit(task, user, Capability.COMPLETE_TASK)
    return mark_reopened(task, actor)


def mark_reopened(task: Task, actor: Actor) -> Task:
    if task.status != Task.Status.DONE:
        return task

    task.status = Task.Status.TODO
    task.completed_at = None
    task.completed_by = None
    task.completed_by_guest = None
    task.completion_source = ""
    task.version = F("version") + 1
    task.save(
        update_fields=[
            "status",
            "completed_at",
            "completed_by",
            "completed_by_guest",
            "completion_source",
            "version",
            "updated_at",
        ]
    )
    task.refresh_from_db()
    _sync_reminder(task)

    emit(
        DomainEvent(
            name=EventName.SUBTASK_REOPENED if task.is_subtask else EventName.TASK_REOPENED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            payload=_payload(task),
            **_event_project_fields(task),
        )
    )
    return task


@transaction.atomic
def delete_task(actor: Actor, task_id: int) -> None:
    user = actor.user
    task = get_task_for_user(task_id, user, for_update=True)
    assert_can_edit(task, user, Capability.DELETE_TASK if task.owner_id != user.pk else Capability.EDIT_TASK)

    payload = _payload(task)
    project_fields = _event_project_fields(task)
    now = timezone.now()
    Task.objects.filter(parent=task).update(deleted_at=now)
    task.deleted_at = now
    task.save(update_fields=["deleted_at"])
    Reminder.objects.filter(task=task, status=Reminder.Status.PENDING).update(status=Reminder.Status.CANCELLED)

    emit(
        DomainEvent(
            name=EventName.TASK_DELETED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            payload=payload,
            **project_fields,
        )
    )


@transaction.atomic
def duplicate_task(actor: Actor, task_id: int) -> Task:
    user = actor.user
    original = get_task_for_user(task_id, user)
    copy = Task.objects.create(
        owner=original.owner,
        created_by=user,
        assignee=original.assignee,
        project=original.project,
        parent=original.parent,
        depth=original.depth,
        kind=original.kind,
        origin=original.origin,
        title=f"{original.title} (copy)"[:300],
        description=original.description,
        notes=original.notes,
        priority=original.priority,
        visibility=original.visibility,
        start_at=original.start_at,
        due_at=original.due_at,
        due_has_time=original.due_has_time,
        estimated_minutes=original.estimated_minutes,
        tags=list(original.tags),
    )
    _update_search_vector(copy)
    emit(
        DomainEvent(
            name=EventName.TASK_CREATED,
            actor=actor,
            target_type="task",
            target_id=copy.pk,
            payload=_payload(copy, duplicated_from=original.pk),
            **_event_project_fields(copy),
        )
    )
    return copy


# --------------------------------------------------------------------------- recurrence


def _spawn_next_recurrence(task: Task, actor: Actor) -> None:
    """
    Materialise-on-complete: at most one future instance exists at any time, so we never create
    infinite future rows.
    """
    rule = task.recurrence
    if rule is None or task.is_subtask:
        return
    if Task.objects.filter(recurrence_parent=task).exists():
        return

    anchor = task.due_at or timezone.now()
    next_due = _next_occurrence(rule, anchor)
    if next_due is None:
        return

    clone = Task.objects.create(
        owner=task.owner,
        created_by=task.created_by,
        assignee=task.assignee,
        project=task.project,
        kind=task.kind,
        origin=task.origin,
        title=task.title,
        description=task.description,
        notes=task.notes,
        priority=task.priority,
        visibility=task.visibility,
        due_at=next_due,
        due_has_time=task.due_has_time,
        estimated_minutes=task.estimated_minutes,
        tags=list(task.tags),
        recurrence=rule,
        recurrence_parent=task,
        reminder_at=(next_due - (task.due_at - task.reminder_at)) if (task.reminder_at and task.due_at) else None,
    )
    RecurrenceRule.objects.filter(pk=rule.pk).update(occurrences_created=F("occurrences_created") + 1)
    _update_search_vector(clone)
    _sync_reminder(clone)
    emit(
        DomainEvent(
            name=EventName.TASK_CREATED,
            actor=Actor.system(),
            target_type="task",
            target_id=clone.pk,
            payload=_payload(clone, recurring_from=task.pk),
            **_event_project_fields(clone),
        )
    )


def _next_occurrence(rule: RecurrenceRule, after: datetime) -> datetime | None:
    if rule.until and after.date() >= rule.until:
        return None
    if rule.count and rule.occurrences_created >= rule.count:
        return None

    kwargs: dict[str, Any] = {"dtstart": after, "interval": max(1, rule.interval)}
    if rule.freq == RecurrenceRule.Freq.DAILY:
        generator = rrule(DAILY, **kwargs)
    elif rule.freq == RecurrenceRule.Freq.WEEKDAYS:
        generator = rrule(DAILY, byweekday=(MO, TU, WE, TH, FR), **kwargs)
    elif rule.freq == RecurrenceRule.Freq.WEEKLY:
        byweekday = [WEEKDAY_MAP[d] for d in rule.byweekday] or None
        generator = rrule(WEEKLY, byweekday=byweekday, **kwargs)
    elif rule.freq == RecurrenceRule.Freq.MONTHLY:
        generator = rrule(MONTHLY, bymonthday=rule.bymonthday or after.day, **kwargs)
    else:
        byweekday = [WEEKDAY_MAP[d] for d in rule.byweekday] or None
        generator = rrule(WEEKLY, byweekday=byweekday, **kwargs)

    following = generator.after(after, inc=False)
    if following is None:
        return None
    if rule.until and following.date() > rule.until:
        return None
    return following


# --------------------------------------------------------------------------- bulk


BULK_MAX_TASKS = 200


def bulk_reschedule(
    actor: Actor, task_ids: list[int], *, due_at: datetime | None, due_has_time: bool = False
) -> dict[str, list[int]]:
    """
    Give several tasks the same deadline (or clear it with ``due_at=None``). Tasks the user cannot edit
    are reported as skipped instead of failing the whole batch, so a mixed selection still gets through.
    """
    ids: list[int] = []
    for raw in task_ids:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value not in ids:
            ids.append(value)
    if not ids:
        raise ValidationFailed("Pick at least one task.")
    if len(ids) > BULK_MAX_TASKS:
        raise ValidationFailed(f"Reschedule at most {BULK_MAX_TASKS} tasks at once.")

    updated: list[int] = []
    skipped: list[int] = []
    for task_id in ids:
        try:
            with transaction.atomic():
                update_task(actor, task_id, due_at=due_at, due_has_time=bool(due_at) and due_has_time)
        except (NotFound, Forbidden, Conflict, ValidationFailed):
            skipped.append(task_id)
        else:
            updated.append(task_id)
    return {"updated": updated, "skipped": skipped}


def move_to_date(actor: Actor, task_id: int, target: date, *, keep_time: bool = True) -> Task:
    task = get_task_for_user(task_id, actor.user)
    from common.tz import combine_local, user_zone

    if task.due_at and keep_time and task.due_has_time:
        local = task.due_at.astimezone(user_zone(actor.user))
        due = combine_local(target, local.time(), actor.user)
    else:
        due = combine_local(target, None, actor.user)
    return update_task(actor, task_id, due_at=due)


def snooze(actor: Actor, task_id: int, *, minutes: int) -> Task:
    task = get_task_for_user(task_id, actor.user)
    base = task.due_at or timezone.now()
    return update_task(actor, task_id, due_at=base + timedelta(minutes=minutes), due_has_time=True)
