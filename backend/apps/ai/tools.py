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


class BulkCompleteIn(BaseModel):
    task_ids: list[int] = Field(..., min_length=1, max_length=50)


class StartTimerIn(BaseModel):
    task_id: int | None = None
    category: Literal["business", "personal"] | None = None


class CreateProjectIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    kind: Literal["project", "idea"] = "project"
    priority: Literal["critical", "high", "normal", "low"] | None = None


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
    for key in ("title", "priority", "kind", "description", "estimated_minutes"):
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
        {"id": p.pk, "name": p.name, "kind": p.kind, "status": p.status, "mode": p.mode}
        for p in Project.objects.visible_to(actor.user).order_by("-updated_at")[:40]
    ]
    return {"projects": rows}


def create_project(actor: Actor, args: CreateProjectIn) -> dict:
    from apps.projects import services

    fields: dict[str, Any] = {"kind": args.kind}
    if args.description:
        fields["description"] = args.description
    if args.priority:
        fields["priority"] = args.priority
    project = services.create_project(actor, name=args.name, **fields)
    return {"created": {"id": project.pk, "name": project.name, "kind": project.kind}}


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
    return {
        "tasks": [_task_row(t, user) for t in tasks],
        "projects": [{"id": p.pk, "name": p.name, "status": p.status} for p in projects],
        "prompts": [{"id": p.pk, "title": p.title, "category": p.category} for p in prompts],
        "ideas": [{"id": i.pk, "title": i.title} for i in ideas],
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
            "create_project",
            "Create a project (or a project idea with kind='idea').",
            CreateProjectIn,
            create_project,
        ),
        Tool("create_idea", "Save a project idea for later.", CreateIdeaIn, create_idea),
        Tool("add_comment", "Add a comment to a task.", AddCommentIn, add_comment),
    ]
}


def tool_definitions() -> list[dict[str, Any]]:
    return [t.definition() for t in TOOLS.values()]
