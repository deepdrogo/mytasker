"""Today dashboard snapshot: everything the Today screen needs in one request."""

from __future__ import annotations

from django.db.models import Q
from django.utils import timezone

from apps.analytics import services as analytics
from apps.projects.models import Project
from apps.routines import services as routine_services
from apps.routines.models import Routine
from apps.routines.serializers import RoutineItemSerializer
from apps.tasks import selectors
from apps.tasks.models import Task
from apps.tasks.serializers import TaskSerializer
from apps.time_tracking import services as time_services
from apps.time_tracking.serializers import SleepSessionSerializer, TimeEntrySerializer
from common.tz import day_bounds, today_for

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def today_snapshot(user, request=None) -> dict:
    day = today_for(user)
    start, end = day_bounds(user, day)
    now = timezone.now()
    ctx = {"request": request}

    base = selectors.base_queryset(user).top_level().annotate(priority_rank=selectors.priority_rank_expression())
    overdue = base.filter(OPEN, due_at__lt=now).exclude(due_at__gte=start).order_by("due_at")[:50]
    due_today = base.filter(OPEN, due_at__gte=start, due_at__lt=end).order_by("priority_rank", "due_at")[:100]
    # "Focus": high priority open tasks without a date, so they don't fall through the cracks.
    focus = (
        base.filter(OPEN, due_at__isnull=True, owner=user)
        .filter(priority__in=["critical", "high"])
        .order_by("priority_rank", "-updated_at")[:10]
    )
    completed = base.filter(status=Task.Status.DONE, completed_at__gte=start, completed_at__lt=end).order_by(
        "-completed_at"
    )[:100]

    metrics = analytics.compute_day(user, day)
    running = time_services.running_entry(user)
    sleep = time_services.running_sleep(user)

    routine_kind = None
    current_item = routine_services.current_item(user)
    routine_items = routine_services.items_for_day(user, routine_kind, day)
    completions = routine_services.completions_for_day(user, day)
    tracked = time_services.tracked_seconds_by_routine_item(user, day)
    routine_ctx = {"completions": completions, "tracked": tracked}

    business_items = [i for i in routine_items if i.routine.kind == Routine.Kind.BUSINESS]
    personal_items = [i for i in routine_items if i.routine.kind == Routine.Kind.PERSONAL]

    active_projects = (
        Project.objects.visible_to(user)
        .filter(status=Project.Status.ACTIVE)
        .order_by("-updated_at")
        .values("id", "name", "priority")[:6]
    )

    return {
        "date": day,
        "now": now,
        "metrics": metrics.as_dict(),
        "streak": analytics.streak(user, day),
        "timer": {
            "running": TimeEntrySerializer(running).data if running else None,
            "sleep": SleepSessionSerializer(sleep).data if sleep else None,
        },
        "tasks": {
            "overdue": TaskSerializer(overdue, many=True, context=ctx).data,
            "due_today": TaskSerializer(due_today, many=True, context=ctx).data,
            "focus": TaskSerializer(focus, many=True, context=ctx).data,
            "completed": TaskSerializer(completed, many=True, context=ctx).data,
        },
        "routine": {
            "current_item_id": current_item.pk if current_item else None,
            "business": RoutineItemSerializer(business_items, many=True, context=routine_ctx).data,
            "personal": RoutineItemSerializer(personal_items, many=True, context=routine_ctx).data,
        },
        "active_projects": list(active_projects),
    }
