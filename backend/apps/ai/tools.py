"""
AI tool layer. Each tool is a thin, validated adapter over the service layer, so the model can
never bypass permissions: every call runs as `Actor.ai(user)` and goes through the same
`visible_to` / capability checks as the REST API.

Destructive or bulk tools are flagged so the command runner can pause for confirmation.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal

from django.db.models import Q
from pydantic import BaseModel, Field, ValidationError

from apps.tasks.models import Task
from common.actors import Actor
from common.dateparse import parse_when
from common.exceptions import DomainError, ValidationFailed
from common.tz import format_local, today_for

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


# --------------------------------------------------------------------------- schemas


class ListTasksIn(BaseModel):
    query: str | None = Field(None, description="Substring to match in the title")
    kind: Literal["personal", "business"] | None = None
    scope: Literal["today", "overdue", "upcoming", "open", "done_today", "all"] = "open"
    project_id: int | None = None
    limit: int = Field(15, ge=1, le=50)


class CreateTaskIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    kind: Literal["personal", "business"] = "personal"
    when: str | None = Field(None, description="Natural language due date/time, e.g. 'tomorrow 15:00', 'friday'")
    priority: Literal["critical", "high", "normal", "low"] | None = None
    project_id: int | None = None
    description: str | None = Field(None, max_length=2000)
    estimated_minutes: int | None = Field(None, ge=1, le=1440)
    is_ongoing: bool | None = Field(
        None,
        description="Long-term work (გრძელვადიანი): no deadline, ticked off once a day, completed only when finished",
    )
    subtasks: list[str] | None = Field(None, description="Optional subtask titles", max_length=20)


class CreateSubtasksIn(BaseModel):
    task_id: int
    titles: list[str] = Field(..., min_length=1, max_length=20)


class TaskIdIn(BaseModel):
    task_id: int


class UpdateTaskIn(BaseModel):
    task_id: int
    title: str | None = Field(None, max_length=300)
    when: str | None = Field(None, description="New due date/time in natural language; 'none' clears it")
    priority: Literal["critical", "high", "normal", "low"] | None = None
    kind: Literal["personal", "business"] | None = None
    description: str | None = Field(None, max_length=2000)
    project_id: int | None = None
    estimated_minutes: int | None = Field(None, ge=1, le=1440)
    is_ongoing: bool | None = None


class BulkCompleteIn(BaseModel):
    task_ids: list[int] = Field(..., min_length=1, max_length=50)


class StartTimerIn(BaseModel):
    task_id: int | None = None
    category: Literal["business", "personal"] | None = None


class CreateProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    kind: Literal["project", "active"] = Field(
        "project", description="'active' pins it to the Active projects list on the dashboard"
    )
    category: Literal["general", "startup"] = Field("general", description="'startup' shelves it under Startups")
    priority: Literal["critical", "high", "normal", "low"] | None = None
    deadline: str | None = Field(None, description="Natural language deadline date, e.g. 'end of month'")


class UpdateProjectIn(BaseModel):
    project_id: int
    name: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=2000)
    status: Literal["planned", "active", "paused", "completed", "archived"] | None = None
    kind: Literal["project", "active"] | None = None
    category: Literal["general", "startup"] | None = None
    priority: Literal["critical", "high", "normal", "low"] | None = None
    deadline: str | None = Field(None, description="Natural language deadline; 'none' clears it")
    notes: str | None = Field(None, max_length=4000)


class ProjectIdIn(BaseModel):
    project_id: int


class ListRoutineIn(BaseModel):
    kind: Literal["personal", "business"] | None = Field(None, description="Omit for both routines")
    only_today: bool = Field(True, description="Only items scheduled for today (default) or the whole routine")


class RoutineItemIn(BaseModel):
    kind: Literal["personal", "business"]
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=300)
    start_time: str | None = Field(None, description="HH:MM local time, e.g. '07:30'")
    end_time: str | None = Field(None, description="HH:MM local time")
    target_minutes: int | None = Field(None, ge=0, le=1440)
    repeat_days: list[int] | None = Field(
        None, description="Weekdays 0=Monday..6=Sunday; omit for every day", max_length=7
    )
    counts_as_business: bool | None = None


class UpdateRoutineItemIn(BaseModel):
    item_id: int
    name: str | None = Field(None, max_length=120)
    description: str | None = Field(None, max_length=300)
    start_time: str | None = Field(None, description="HH:MM local time; 'none' clears it")
    end_time: str | None = Field(None, description="HH:MM local time; 'none' clears it")
    target_minutes: int | None = Field(None, ge=0, le=1440)
    repeat_days: list[int] | None = Field(None, max_length=7)
    counts_as_business: bool | None = None
    is_active: bool | None = None


class RoutineItemIdIn(BaseModel):
    item_id: int


class RoutineItemCompleteIn(BaseModel):
    item_id: int
    completed: bool = True
    minutes: int | None = Field(None, ge=0, le=1440, description="Manual minutes spent, optional")


class ReorderRoutineIn(BaseModel):
    kind: Literal["personal", "business"]
    item_ids: list[int] = Field(..., min_length=1, max_length=100, description="Item ids in the desired order")


class RuleIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=1000)


class UpdateRuleIn(BaseModel):
    rule_id: int
    text: str | None = Field(None, max_length=200)
    description: str | None = Field(None, max_length=1000)
    is_enabled: bool | None = None


class RuleIdIn(BaseModel):
    rule_id: int


class RuleKeptIn(BaseModel):
    rule_id: int
    kept: bool = Field(True, description="True = kept today, False = broken today")


class ListSubtasksIn(BaseModel):
    task_id: int


class AddCommentIn(BaseModel):
    task_id: int
    body: str = Field(..., min_length=1, max_length=4000)


class SearchIn(BaseModel):
    query: str = Field(..., min_length=1, max_length=200)


class EmptyIn(BaseModel):
    pass


class CreateIdeaIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    raw_text: str | None = Field(None, max_length=4000)


# --------------------------------------------------------------------------- helpers


def _task_row(task: Task, user) -> dict[str, Any]:
    return {
        "id": task.pk,
        "title": task.title,
        "kind": task.kind,
        "status": task.status,
        "priority": task.priority,
        "due": format_local(task.due_at, user, "%Y-%m-%d %H:%M" if task.due_has_time else "%Y-%m-%d")
        if task.due_at
        else None,
        "project": task.project.name if task.project_id and task.project else None,
        "project_id": task.project_id,
        "subtasks": getattr(task, "subtask_total", None),
    }


def _resolve_when(user, when: str | None) -> dict[str, Any]:
    if when is None:
        return {}
    if when.strip().lower() in ("none", "clear", "no date", ""):
        return {"due_at": None, "due_has_time": False, "reminder_at": None}
    parsed = parse_when(when, user)
    if parsed.due_at is None:
        try:
            dt = datetime.fromisoformat(when)
            return {"due_at": dt, "due_has_time": True}
        except ValueError as exc:
            raise ValidationFailed(f"Could not understand the date “{when}”.") from exc
    out: dict[str, Any] = {"due_at": parsed.due_at, "due_has_time": parsed.has_time}
    return out


# --------------------------------------------------------------------------- tool impls


def list_tasks(actor: Actor, args: ListTasksIn) -> dict:
    from common.tz import day_bounds

    user = actor.user
    qs = Task.objects.visible_to(user).filter(parent__isnull=True).select_related("project")
    start, end = day_bounds(user)
    if args.scope == "today":
        qs = qs.filter(OPEN, due_at__lt=end)
    elif args.scope == "overdue":
        qs = qs.filter(OPEN, due_at__lt=start)
    elif args.scope == "upcoming":
        qs = qs.filter(OPEN, due_at__gte=end)
    elif args.scope == "open":
        qs = qs.filter(OPEN)
    elif args.scope == "done_today":
        qs = qs.filter(status=Task.Status.DONE, completed_at__gte=start, completed_at__lt=end)
    if args.kind:
        qs = qs.filter(kind=args.kind)
    if args.project_id:
        qs = qs.filter(project_id=args.project_id)
    if args.query:
        qs = qs.filter(title__icontains=args.query.strip())
    rows = [_task_row(t, user) for t in qs.order_by("due_at", "-priority")[: args.limit]]
    return {"count": len(rows), "tasks": rows}


def create_task(actor: Actor, args: CreateTaskIn) -> dict:
    from apps.tasks import services

    fields = _resolve_when(actor.user, args.when)
    if args.priority:
        fields["priority"] = args.priority
    if args.description:
        fields["description"] = args.description
    if args.estimated_minutes:
        fields["estimated_minutes"] = args.estimated_minutes
    if args.is_ongoing is not None:
        fields["is_ongoing"] = args.is_ongoing
    task = services.create_task(actor, title=args.title, kind=args.kind, project_id=args.project_id, **fields)
    created = [_task_row(task, actor.user)]
    for title in args.subtasks or []:
        if title.strip():
            sub = services.create_task(actor, title=title.strip()[:300], kind=task.kind, parent_id=task.pk)
            created.append({"id": sub.pk, "title": sub.title, "parent_id": task.pk})
    return {"created": created}


def create_subtasks(actor: Actor, args: CreateSubtasksIn) -> dict:
    from apps.tasks import services

    parent = services.get_task_for_user(args.task_id, actor.user)
    rows = []
    for title in args.titles:
        if title.strip():
            sub = services.create_task(actor, title=title.strip()[:300], kind=parent.kind, parent_id=parent.pk)
            rows.append({"id": sub.pk, "title": sub.title})
    return {"parent": _task_row(parent, actor.user), "created": rows}


def complete_task(actor: Actor, args: TaskIdIn) -> dict:
    from apps.tasks import services

    task = services.complete_task(actor, args.task_id)
    return {"completed": _task_row(task, actor.user)}


def reopen_task(actor: Actor, args: TaskIdIn) -> dict:
    from apps.tasks import services

    task = services.reopen_task(actor, args.task_id)
    return {"reopened": _task_row(task, actor.user)}


def update_task(actor: Actor, args: UpdateTaskIn) -> dict:
    from apps.tasks import services

    fields: dict[str, Any] = _resolve_when(actor.user, args.when)
    for key in ("title", "priority", "kind", "description", "estimated_minutes", "is_ongoing"):
        value = getattr(args, key)
        if value is not None:
            fields[key] = value
    if args.project_id is not None:
        fields["project_id"] = args.project_id
    task = services.update_task(actor, args.task_id, **fields)
    return {"updated": _task_row(task, actor.user)}


def delete_task(actor: Actor, args: TaskIdIn) -> dict:
    from apps.tasks import services

    task = services.get_task_for_user(args.task_id, actor.user)
    title = task.title
    services.delete_task(actor, args.task_id)
    return {"deleted": {"id": args.task_id, "title": title}}


def complete_tasks(actor: Actor, args: BulkCompleteIn) -> dict:
    from apps.tasks import services

    done = []
    for task_id in args.task_ids:
        try:
            done.append(_task_row(services.complete_task(actor, task_id), actor.user))
        except DomainError as exc:
            done.append({"id": task_id, "error": exc.message})
    return {"completed": done}


def start_timer(actor: Actor, args: StartTimerIn) -> dict:
    from apps.time_tracking import services

    entry = services.start_timer(actor, task_id=args.task_id, category=args.category)
    return {
        "timer": {"id": entry.pk, "task": entry.task.title if entry.task_id else None, "category": entry.category}
    }


def stop_timer(actor: Actor, args: EmptyIn) -> dict:
    from apps.time_tracking import services

    entry = services.stop_timer(actor)
    return {"stopped": {"id": entry.pk, "duration_minutes": entry.duration_seconds // 60, "category": entry.category}}


def list_projects(actor: Actor, args: EmptyIn) -> dict:
    from apps.projects.models import Project

    rows = [
        _project_row(p)
        for p in Project.objects.visible_to(actor.user)
        .with_progress(actor.user)
        .order_by("status", "-updated_at")[:40]
    ]
    return {"projects": rows}


def _resolve_date(user, text: str | None):
    """Natural language → local date, or None when the text means 'clear'."""
    if text is None:
        return None, False
    if text.strip().lower() in ("none", "clear", "no date", ""):
        return None, True
    parsed = parse_when(text, user)
    if parsed.due_at is None:
        try:
            return datetime.fromisoformat(text).date(), True
        except ValueError as exc:
            raise ValidationFailed(f"Could not understand the date “{text}”.") from exc
    from common.tz import local_date

    return local_date(parsed.due_at, user), True


def _project_row(project) -> dict[str, Any]:
    return {
        "id": project.pk,
        "name": project.name,
        "kind": project.kind,
        "category": project.category,
        "status": project.status,
        "priority": project.priority,
        "deadline": str(project.deadline) if project.deadline else None,
        "mode": project.mode,
        "open_tasks": getattr(project, "task_open", None),
        "total_tasks": getattr(project, "task_total", None),
    }


def create_project(actor: Actor, args: CreateProjectIn) -> dict:
    from apps.projects import services

    fields: dict[str, Any] = {"kind": args.kind, "category": args.category}
    if args.description:
        fields["description"] = args.description
    if args.priority:
        fields["priority"] = args.priority
    deadline, given = _resolve_date(actor.user, args.deadline)
    if given and deadline is not None:
        fields["deadline"] = deadline
    project = services.create_project(actor, name=args.name, **fields)
    return {"created": _project_row(project)}


def update_project(actor: Actor, args: UpdateProjectIn) -> dict:
    from apps.projects import services

    fields: dict[str, Any] = {}
    for key in ("name", "description", "status", "kind", "category", "priority", "notes"):
        value = getattr(args, key)
        if value is not None:
            fields[key] = value
    deadline, given = _resolve_date(actor.user, args.deadline)
    if given:
        fields["deadline"] = deadline
    if not fields:
        raise ValidationFailed("Nothing to change on the project.")
    project = services.update_project(actor, args.project_id, **fields)
    return {"updated": _project_row(project)}


def delete_project(actor: Actor, args: ProjectIdIn) -> dict:
    from apps.projects import services

    project = services.get_project_for_user(args.project_id, actor.user)
    name = project.name
    services.delete_project(actor, args.project_id)
    return {"deleted": {"id": args.project_id, "name": name}}


def project_tasks(actor: Actor, args: ProjectIdIn) -> dict:
    """Open tasks of one project with their subtasks - the model needs this to 'sort out' a project."""
    from apps.projects import services

    project = services.get_project_for_user(args.project_id, actor.user)
    user = actor.user
    parents = list(
        Task.objects.visible_to(user)
        .filter(project=project, parent__isnull=True)
        .filter(OPEN)
        .select_related("project")
        .order_by("sort_order", "due_at", "id")[:60]
    )
    subs: dict[int, list[dict]] = {}
    for sub in Task.objects.visible_to(user).filter(parent__in=parents).order_by("sort_order", "id"):
        subs.setdefault(sub.parent_id, []).append({"id": sub.pk, "title": sub.title, "status": sub.status})
    rows = []
    for t in parents:
        row = _task_row(t, user)
        row["subtasks"] = subs.get(t.pk, [])
        rows.append(row)
    return {"project": _project_row(project), "tasks": rows}


def list_subtasks(actor: Actor, args: ListSubtasksIn) -> dict:
    from apps.tasks import services

    parent = services.get_task_for_user(args.task_id, actor.user)
    rows = [
        {"id": s.pk, "title": s.title, "status": s.status, "priority": s.priority}
        for s in Task.objects.visible_to(actor.user).filter(parent=parent).order_by("sort_order", "id")
    ]
    return {"parent": _task_row(parent, actor.user), "subtasks": rows}


# ------------------------------------------------------------------ routines & rules

_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _parse_hhmm(value: str | None, *, field: str):
    """'HH:MM' → time; None → unchanged (sentinel False); 'none' → clear (None)."""
    if value is None:
        return False
    text = value.strip().lower()
    if text in ("none", "clear", ""):
        return None
    from datetime import time as dtime

    try:
        hours, minutes = text.split(":")
        return dtime(int(hours), int(minutes))
    except (ValueError, AttributeError) as exc:
        raise ValidationFailed(f"{field} must look like HH:MM.") from exc


def _days_mask(days: list[int] | None) -> int | None:
    if days is None:
        return None
    mask = 0
    for d in days:
        if 0 <= int(d) <= 6:
            mask |= 1 << int(d)
    return mask or 127


def _routine_row(item, completion=None, tracked_seconds: int = 0) -> dict[str, Any]:
    days = [_WEEKDAYS[i] for i in range(7) if item.repeat_days & (1 << i)]
    return {
        "id": item.pk,
        "kind": item.routine.kind,
        "name": item.name,
        "description": item.description or None,
        "window": f"{item.start_time:%H:%M}-{item.end_time:%H:%M}" if item.start_time and item.end_time else None,
        "target_minutes": item.target_minutes,
        "days": "daily" if len(days) == 7 else ",".join(days),
        "order": item.order,
        "counts_as_business": item.counts_as_business,
        "is_active": item.is_active,
        "completed_today": bool(completion and completion.completed),
        "minutes_today": (
            completion.manual_minutes
            if completion and completion.manual_minutes is not None
            else tracked_seconds // 60
        ),
    }


def list_routine(actor: Actor, args: ListRoutineIn) -> dict:
    from apps.routines import services
    from apps.routines.models import RoutineItem
    from apps.time_tracking.services import tracked_seconds_by_routine_item

    user = actor.user
    day = today_for(user)
    if args.only_today:
        items = services.items_for_day(user, args.kind, day)
    else:
        qs = RoutineItem.objects.filter(routine__owner=user, routine__deleted_at__isnull=True).select_related(
            "routine"
        )
        if args.kind:
            qs = qs.filter(routine__kind=args.kind)
        items = list(qs)
    items.sort(key=lambda i: (i.routine.kind, i.order, i.start_time or datetime.min.time(), i.pk))
    completions = services.completions_for_day(user, day)
    tracked = tracked_seconds_by_routine_item(user, day)
    current = services.current_item(user, args.kind)
    return {
        "date": str(day),
        "current_item_id": current.pk if current else None,
        "items": [_routine_row(i, completions.get(i.pk), int(tracked.get(i.pk, 0))) for i in items],
    }


def _routine_fields(args, *, creating: bool) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for key in ("name", "description", "target_minutes", "counts_as_business"):
        value = getattr(args, key, None)
        if value is not None:
            fields[key] = value
    if getattr(args, "is_active", None) is not None:
        fields["is_active"] = args.is_active
    for key in ("start_time", "end_time"):
        parsed = _parse_hhmm(getattr(args, key), field=key)
        if parsed is not False:
            fields[key] = parsed
    mask = _days_mask(args.repeat_days)
    if mask is not None:
        fields["repeat_days"] = mask
    if not creating and not fields:
        raise ValidationFailed("Nothing to change on the routine item.")
    return fields


def create_routine_item(actor: Actor, args: RoutineItemIn) -> dict:
    from apps.routines import services

    item = services.create_item(actor.user, args.kind, **_routine_fields(args, creating=True))
    return {"created": _routine_row(item)}


def update_routine_item(actor: Actor, args: UpdateRoutineItemIn) -> dict:
    from apps.routines import services

    item = services.update_item(actor.user, args.item_id, **_routine_fields(args, creating=False))
    return {"updated": _routine_row(item)}


def delete_routine_item(actor: Actor, args: RoutineItemIdIn) -> dict:
    from apps.routines import services
    from apps.routines.models import RoutineItem

    item = RoutineItem.objects.filter(pk=args.item_id, routine__owner=actor.user).first()
    name = item.name if item else str(args.item_id)
    services.delete_item(actor.user, args.item_id)
    return {"deleted": {"id": args.item_id, "name": name}}


def complete_routine_item(actor: Actor, args: RoutineItemCompleteIn) -> dict:
    from apps.routines import services
    from apps.routines.models import RoutineItem

    completion = services.set_completion(
        actor.user, args.item_id, completed=args.completed, manual_minutes=args.minutes
    )
    item = RoutineItem.objects.select_related("routine").get(pk=args.item_id)
    return {"item": _routine_row(item, completion)}


def reorder_routine(actor: Actor, args: ReorderRoutineIn) -> dict:
    from apps.routines import services
    from apps.routines.models import RoutineItem

    services.reorder_items(actor.user, args.kind, args.item_ids)
    items = RoutineItem.objects.filter(routine__owner=actor.user, routine__kind=args.kind).select_related("routine")
    return {"order": [{"id": i.pk, "name": i.name, "order": i.order} for i in items]}


def _rule_row(rule, completion=None, streak: int = 0) -> dict[str, Any]:
    return {
        "id": rule.pk,
        "text": rule.text,
        "description": rule.description or None,
        "is_enabled": rule.is_enabled,
        "kept_today": None if completion is None else bool(completion.kept),
        "streak_days": streak,
    }


def list_rules(actor: Actor, args: EmptyIn) -> dict:
    from apps.routines import services
    from apps.routines.models import Rule

    user = actor.user
    completions = services.rule_completions_for_day(user)
    streaks = services.rule_streaks(user)
    rows = [_rule_row(r, completions.get(r.pk), streaks.get(r.pk, 0)) for r in Rule.objects.filter(owner=user)]
    return {"rules": rows}


def create_rule(actor: Actor, args: RuleIn) -> dict:
    from apps.routines import services

    rule = services.create_rule(actor.user, text=args.text, description=args.description or "")
    return {"created": _rule_row(rule)}


def update_rule(actor: Actor, args: UpdateRuleIn) -> dict:
    from apps.routines import services

    fields = {k: getattr(args, k) for k in ("text", "description", "is_enabled") if getattr(args, k) is not None}
    if not fields:
        raise ValidationFailed("Nothing to change on the rule.")
    rule = services.update_rule(actor.user, args.rule_id, **fields)
    return {"updated": _rule_row(rule)}


def delete_rule(actor: Actor, args: RuleIdIn) -> dict:
    from apps.routines import services
    from apps.routines.models import Rule

    rule = Rule.objects.filter(pk=args.rule_id, owner=actor.user).first()
    text = rule.text if rule else str(args.rule_id)
    services.delete_rule(actor.user, args.rule_id)
    return {"deleted": {"id": args.rule_id, "text": text}}


def mark_rule(actor: Actor, args: RuleKeptIn) -> dict:
    from apps.routines import services
    from apps.routines.models import Rule

    completion = services.set_rule_kept(actor.user, args.rule_id, kept=args.kept)
    rule = Rule.objects.get(pk=args.rule_id, owner=actor.user)
    return {"rule": _rule_row(rule, completion, services.rule_streaks(actor.user).get(rule.pk, 0))}


def create_idea(actor: Actor, args: CreateIdeaIn) -> dict:
    from apps.projects import services

    idea = services.create_idea(actor, title=args.title, raw_text=args.raw_text or "")
    return {"created": {"id": idea.pk, "title": idea.title}}


def add_comment(actor: Actor, args: AddCommentIn) -> dict:
    from apps.collab import services

    comment = services.create_comment(actor, body=args.body, task_id=args.task_id)
    return {"comment": {"id": comment.pk, "task_id": args.task_id}}


def today_overview(actor: Actor, args: EmptyIn) -> dict:
    from apps.analytics import services as analytics
    from apps.time_tracking import services as time_services

    user = actor.user
    m = analytics.compute_day(user, today_for(user))
    running = time_services.running_entry(user)
    return {
        "date": str(m.date),
        "tasks_planned": m.tasks_planned,
        "tasks_completed": m.tasks_completed,
        "tasks_missed": m.tasks_missed,
        "business_minutes": m.business_minutes,
        "business_target_minutes": m.business_target_minutes,
        "routine": f"{m.routine_items_completed}/{m.routine_items_total}",
        "timer_running": {
            "task": running.task.title if running and running.task_id else None,
            "category": running.category,
        }
        if running
        else None,
    }


def search(actor: Actor, args: SearchIn) -> dict:
    from apps.projects.models import Idea, Project
    from apps.prompts.models import Prompt

    user = actor.user
    term = args.query.strip()
    tasks = (
        Task.objects.visible_to(user)
        .filter(title__icontains=term)
        .select_related("project")
        .order_by("status", "-updated_at")[:6]
    )
    projects = Project.objects.visible_to(user).filter(Q(name__icontains=term) | Q(description__icontains=term))[:5]
    prompts = Prompt.objects.visible_to(user).filter(title__icontains=term).only("id", "title", "category")[:5]
    ideas = Idea.objects.filter(owner=user, title__icontains=term).only("id", "title")[:5]
    from apps.routines.models import RoutineItem, Rule

    routine_items = RoutineItem.objects.filter(routine__owner=user, name__icontains=term).select_related("routine")[
        :5
    ]
    rules = Rule.objects.filter(owner=user, text__icontains=term)[:5]
    return {
        "tasks": [_task_row(t, user) for t in tasks],
        "projects": [{"id": p.pk, "name": p.name, "status": p.status} for p in projects],
        "prompts": [{"id": p.pk, "title": p.title, "category": p.category} for p in prompts],
        "ideas": [{"id": i.pk, "title": i.title} for i in ideas],
        "routine_items": [{"id": r.pk, "name": r.name, "kind": r.routine.kind} for r in routine_items],
        "rules": [{"id": r.pk, "text": r.text} for r in rules],
    }


# --------------------------------------------------------------------------- registry


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    schema: type[BaseModel]
    run: Callable[[Actor, BaseModel], dict]
    destructive: bool = False  # requires explicit confirmation
    mutating: bool = True

    def definition(self) -> dict[str, Any]:
        schema = self.schema.model_json_schema()
        schema.pop("title", None)
        for prop in schema.get("properties", {}).values():
            prop.pop("title", None)
        return {"name": self.name, "description": self.description, "input_schema": schema}

    def invoke(self, actor: Actor, raw: dict[str, Any]) -> dict:
        try:
            args = self.schema.model_validate(raw or {})
        except ValidationError as exc:
            raise ValidationFailed(
                f"Invalid arguments for {self.name}: {exc.errors()[0].get('msg', 'invalid')}"
            ) from exc
        return self.run(actor, args)


TOOLS: dict[str, Tool] = {
    t.name: t
    for t in [
        Tool(
            "list_tasks",
            "List the user's tasks (open by default). Use before completing/updating when you need an id.",
            ListTasksIn,
            list_tasks,
            mutating=False,
        ),
        Tool(
            "today_overview",
            "Numbers for today: planned/completed/missed tasks, business minutes vs target, routine, running timer.",
            EmptyIn,
            today_overview,
            mutating=False,
        ),
        Tool("search", "Search tasks, projects, prompts and ideas by text.", SearchIn, search, mutating=False),
        Tool(
            "list_projects",
            "List projects visible to the user (id, name, kind, status).",
            EmptyIn,
            list_projects,
            mutating=False,
        ),
        Tool(
            "create_task",
            "Create a task. Put the due date in `when` as natural language; optionally include subtasks.",
            CreateTaskIn,
            create_task,
        ),
        Tool("create_subtasks", "Add subtasks to an existing task.", CreateSubtasksIn, create_subtasks),
        Tool(
            "update_task",
            "Change title, due date (`when`), priority, kind, project or description of a task.",
            UpdateTaskIn,
            update_task,
        ),
        Tool("complete_task", "Mark one task as done.", TaskIdIn, complete_task),
        Tool(
            "complete_tasks", "Mark several tasks as done at once.", BulkCompleteIn, complete_tasks, destructive=True
        ),
        Tool("reopen_task", "Reopen a completed task.", TaskIdIn, reopen_task),
        Tool(
            "delete_task",
            "Delete a task permanently (soft delete). Always requires confirmation.",
            TaskIdIn,
            delete_task,
            destructive=True,
        ),
        Tool(
            "start_timer",
            "Start the time tracker for a task or a category (stops any running timer).",
            StartTimerIn,
            start_timer,
        ),
        Tool("stop_timer", "Stop the running timer.", EmptyIn, stop_timer),
        Tool(
            "list_subtasks",
            "List the subtasks of one task (id, title, status). Use before renaming or completing subtasks.",
            ListSubtasksIn,
            list_subtasks,
            mutating=False,
        ),
        # Projects
        Tool(
            "project_tasks",
            "Open tasks of one project together with their subtasks. Use this to review or 'sort out' a project.",
            ProjectIdIn,
            project_tasks,
            mutating=False,
        ),
        Tool(
            "create_project",
            "Create a project or startup (category='startup'). For a loose idea use create_idea instead.",
            CreateProjectIn,
            create_project,
        ),
        Tool(
            "update_project",
            "Change a project's name, description, status (planned/active/paused/completed/archived), kind, "
            "category, priority, deadline or notes.",
            UpdateProjectIn,
            update_project,
        ),
        Tool(
            "delete_project",
            "Delete a project and everything in it. Always requires confirmation.",
            ProjectIdIn,
            delete_project,
            destructive=True,
        ),
        Tool("create_idea", "Save a project idea for later.", CreateIdeaIn, create_idea),
        Tool("add_comment", "Add a comment to a task.", AddCommentIn, add_comment),
        # Routines
        Tool(
            "list_routine",
            "Routine blocks (personal and/or business) with time windows, target minutes, weekdays and today's "
            "completion. Call this first when the user talks about their routine / daily schedule.",
            ListRoutineIn,
            list_routine,
            mutating=False,
        ),
        Tool(
            "create_routine_item",
            "Add a block to the personal or business routine (name, HH:MM window, target minutes, weekdays).",
            RoutineItemIn,
            create_routine_item,
        ),
        Tool(
            "update_routine_item",
            "Change a routine block: rename, move its time window, target minutes, weekdays, pause (is_active).",
            UpdateRoutineItemIn,
            update_routine_item,
        ),
        Tool(
            "delete_routine_item",
            "Remove a routine block. Always requires confirmation.",
            RoutineItemIdIn,
            delete_routine_item,
            destructive=True,
        ),
        Tool(
            "complete_routine_item",
            "Tick (or untick) a routine block for today, optionally with minutes spent.",
            RoutineItemCompleteIn,
            complete_routine_item,
        ),
        Tool(
            "reorder_routine",
            "Reorder the blocks of one routine. Pass every item id in the new order (use list_routine first).",
            ReorderRoutineIn,
            reorder_routine,
        ),
        # Rules
        Tool(
            "list_rules",
            "The user's personal rules / principles with today's kept-or-broken mark and streak.",
            EmptyIn,
            list_rules,
            mutating=False,
        ),
        Tool("create_rule", "Add a personal rule (a principle, not a task).", RuleIn, create_rule),
        Tool("update_rule", "Rewrite, describe, enable or disable a rule.", UpdateRuleIn, update_rule),
        Tool("delete_rule", "Delete a rule. Always requires confirmation.", RuleIdIn, delete_rule, destructive=True),
        Tool("mark_rule", "Mark a rule as kept or broken for today.", RuleKeptIn, mark_rule),
    ]
}


def tool_definitions() -> list[dict[str, Any]]:
    return [t.definition() for t in TOOLS.values()]
