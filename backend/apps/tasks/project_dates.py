# MyTasker — tasks borrow their project's calendar span.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""
A project drawn on the timeline (start → deadline) hands those dates to every open top-level task that
has none of its own. The borrowed dates are written into ``start_at`` / ``due_at`` so Today, Upcoming,
the task calendar, counts and reminders treat them exactly like dates set by hand; ``dates_from_project``
remembers that they are borrowed, so moving, stretching or removing the project bar moves, stretches or
clears them too. Setting a date on the task itself makes it the task's own and ends the link.
"""

from __future__ import annotations

from datetime import datetime, time

from django.db.models import F, Q
from django.utils import timezone

from apps.tasks.models import Task
from common.tz import combine_local

OPEN_STATUSES = (Task.Status.TODO, Task.Status.IN_PROGRESS)
DATE_FIELDS = ("start_at", "due_at", "due_has_time", "dates_from_project")


def _can_borrow(task: Task) -> bool:
    """Subtasks follow their parent; long-term and repeating work keep their own rhythm."""
    return task.parent_id is None and not task.is_ongoing and task.recurrence_id is None


def borrowed_span(task: Task) -> tuple[datetime | None, datetime | None]:
    """
    The project's start (00:00) and deadline (23:59, date-only) as moments in the task owner's timezone,
    the same way a date picked in the task editor is stored. ``(None, None)`` when there is nothing to borrow.
    """
    project = task.project if task.project_id else None
    if project is None or project.deleted_at is not None or not _can_borrow(task):
        return None, None
    start = combine_local(project.start_date, time.min, task.owner) if project.start_date else None
    due = combine_local(project.deadline, None, task.owner) if project.deadline else None
    return start, due


def apply_project_dates(task: Task) -> list[str]:
    """
    Bring one task in line with its project, in memory. Returns the fields that changed (not saved).
    Finished work keeps whatever dates it had; dates the user set on the task are never touched.
    """
    if task.status not in OPEN_STATUSES:
        return []
    if not task.dates_from_project and (task.start_at or task.due_at):
        return []

    start, due = borrowed_span(task)
    if start is None and due is None:
        if not task.dates_from_project:
            return []
        wanted = {"start_at": None, "due_at": None, "due_has_time": False, "dates_from_project": False}
    else:
        wanted = {"start_at": start, "due_at": due, "due_has_time": False, "dates_from_project": True}

    changed = [name for name, value in wanted.items() if getattr(task, name) != value]
    for name in changed:
        setattr(task, name, wanted[name])
    return changed


def sync_project_tasks(project) -> list[int]:
    """After the project's start or deadline changed: re-borrow for every task that follows it."""
    tasks = list(
        Task.objects.filter(project=project, parent__isnull=True, status__in=OPEN_STATUSES)
        .filter(Q(dates_from_project=True) | Q(start_at__isnull=True, due_at__isnull=True))
        .select_related("owner", "project")
    )
    touched: list[Task] = []
    now = timezone.now()
    for task in tasks:
        # Read the project as just saved, not a stale copy cached on the task.
        task.project = project
        if apply_project_dates(task):
            task.version = F("version") + 1
            task.updated_at = now
            touched.append(task)
    if touched:
        Task.objects.bulk_update(touched, [*DATE_FIELDS, "version", "updated_at"])
    return [task.pk for task in touched]
