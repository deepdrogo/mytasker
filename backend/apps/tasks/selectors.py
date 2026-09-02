"""Read-side queries for tasks: annotated, index-friendly, no N+1."""

from __future__ import annotations

from datetime import datetime

from django.db.models import Count, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.tasks.models import Task
from common.models import PRIORITY_RANK


def base_queryset(user):
    from apps.collab.models import Comment
    from apps.time_tracking.models import TimeEntry

    subtasks = Task.objects.filter(parent=OuterRef("pk"), deleted_at__isnull=True)
    tracked = (
        TimeEntry.objects.filter(task=OuterRef("pk"))
        .values("task")
        .annotate(total=Sum("duration_seconds"))
        .values("total")[:1]
    )
    comments = (
        Comment.objects.filter(task=OuterRef("pk"), deleted_at__isnull=True)
        .values("task")
        .annotate(c=Count("*"))
        .values("c")[:1]
    )
    return (
        Task.objects.visible_to(user)
        .select_related("project", "owner", "assignee", "completed_by", "completed_by_guest", "recurrence", "parent")
        .annotate(
            subtask_total=Coalesce(
                Subquery(
                    subtasks.values("parent").annotate(c=Count("*")).values("c")[:1], output_field=IntegerField()
                ),
                Value(0),
            ),
            subtask_done=Coalesce(
                Subquery(
                    subtasks.filter(status=Task.Status.DONE).values("parent").annotate(c=Count("*")).values("c")[:1],
                    output_field=IntegerField(),
                ),
                Value(0),
            ),
            tracked_seconds=Coalesce(Subquery(tracked, output_field=IntegerField()), Value(0)),
            comment_count=Coalesce(Subquery(comments, output_field=IntegerField()), Value(0)),
        )
    )


def priority_rank_expression():
    """Semantic priority rank (critical=0 .. low=3) so ordering is meaningful, not alphabetical."""
    from django.db.models import Case, When

    whens = [When(priority=key, then=Value(rank)) for key, rank in PRIORITY_RANK.items()]
    return Case(*whens, default=Value(9), output_field=IntegerField())


def due_between(qs, start: datetime, end: datetime):
    return qs.filter(due_at__gte=start, due_at__lt=end)


def overdue(qs, now: datetime | None = None):
    return qs.filter(due_at__lt=now or timezone.now()).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def open_tasks(qs):
    return qs.exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def completed_between(qs, start: datetime, end: datetime):
    return qs.filter(status=Task.Status.DONE, completed_at__gte=start, completed_at__lt=end)


def for_today(user, start: datetime, end: datetime, kind: str | None = None):
    """Tasks due today or overdue, plus anything already completed today."""
    qs = base_queryset(user).top_level()
    if kind:
        qs = qs.filter(kind=kind)
    return qs.filter(
        Q(due_at__lt=end, status__in=[Task.Status.TODO, Task.Status.IN_PROGRESS])
        | Q(status=Task.Status.DONE, completed_at__gte=start, completed_at__lt=end)
        | Q(due_at__isnull=True, status=Task.Status.IN_PROGRESS)
    )
