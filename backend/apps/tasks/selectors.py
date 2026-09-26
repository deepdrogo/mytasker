"""Read-side queries for tasks: annotated, index-friendly, no N+1."""

from __future__ import annotations

from datetime import datetime

from django.db.models import Count, Exists, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.tasks.models import Task, TaskCheckin
from common.models import PRIORITY_RANK
from common.tz import today_for


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
    # Daily check-in tally for long-term tasks: how many days were done, how many deliberately skipped.
    today = today_for(user)
    todays_checkin = TaskCheckin.objects.filter(task=OuterRef("pk"), date=today)

    def checkin_count(skipped: bool):
        return Coalesce(
            Subquery(
                TaskCheckin.objects.filter(task=OuterRef("pk"), skipped=skipped)
                .values("task")
                .annotate(c=Count("*"))
                .values("c")[:1],
                output_field=IntegerField(),
            ),
            Value(0),
        )

    return (
        Task.objects.visible_to(user)
        .select_related(
            "project",
            "owner",
            "assignee",
            "created_by",
            "completed_by",
            "completed_by_guest",
            "recurrence",
            "parent",
        )
        .prefetch_related("assignees")
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
            today_checked=Exists(todays_checkin.filter(skipped=False)),
            today_skipped=Exists(todays_checkin.filter(skipped=True)),
            checkin_done_count=checkin_count(False),
            checkin_skipped_count=checkin_count(True),
        )
    )


def own_plate(queryset, user):
    """
    Tasks that belong on the user's own lists, counts and graphs.

    Work handed to someone else lives on People. Work someone else handed to this user
    lives on their From page. Neither shows up on Today, the other task lists, sidebar
    counts or the Insights charts.
    """
    handed = Task.assignees.through.objects.filter(task_id=OuterRef("pk"))
    handed_to_others = Exists(handed.exclude(user_id=user.pk))
    handed_to_me = Exists(handed.filter(user_id=user.pk))
    return (
        queryset.exclude(Q(assignee__isnull=False) & ~Q(assignee_id=user.pk))
        .exclude(handed_to_others)
        .exclude(~Q(owner_id=user.pk) & (Q(assignee_id=user.pk) | handed_to_me))
    )


def priority_rank_expression():
    """Semantic priority rank (critical=0 .. low=3) so ordering is meaningful, not alphabetical."""
    from django.db.models import Case, When

    whens = [When(priority=key, then=Value(rank)) for key, rank in PRIORITY_RANK.items()]
    return Case(*whens, default=Value(9), output_field=IntegerField())


def due_between(qs, start: datetime, end: datetime):
    return qs.filter(due_at__gte=start, due_at__lt=end)


def overdue_q(user, now: datetime | None = None) -> Q:
    """
    Past the deadline, for open or done work alike (callers add the status filter). A timed deadline is
    late once its minute passes; a date-only one only once its whole day is over in the user's timezone,
    whatever hour happens to be stored.
    """
    from common.tz import day_bounds

    start_of_today, _ = day_bounds(user)
    return Q(due_has_time=True, due_at__lt=now or timezone.now()) | Q(due_has_time=False, due_at__lt=start_of_today)


def overdue(qs, user, now: datetime | None = None):
    return qs.filter(overdue_q(user, now)).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


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
