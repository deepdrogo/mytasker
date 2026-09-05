"""Today dashboard snapshot: everything the Today screen needs in one request."""

from __future__ import annotations

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.analytics import services as analytics
from apps.projects.models import Project
from apps.routines import services as routine_services
from apps.routines.models import Routine, Rule
from apps.routines.serializers import RoutineItemSerializer, RuleSerializer
from apps.tasks import selectors
from apps.tasks import services as task_services
from apps.tasks.models import Task
from apps.tasks.serializers import TaskSerializer
from apps.time_tracking import services as time_services
from apps.time_tracking.serializers import SleepSessionSerializer, TimeEntrySerializer
from common.tz import day_bounds, today_for

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def models_f_nulls_last(field: str):
    from django.db.models import F

    return F(field).asc(nulls_last=True)


def today_snapshot(user, request=None) -> dict:
    day = today_for(user)
    start, end = day_bounds(user, day)
    now = timezone.now()
    ctx = {"request": request}

    # Crypto world is a private list — never mixed into the Today dashboard.
    base = (
        selectors.base_queryset(user)
        .top_level()
        .exclude(kind=Task.Kind.CRYPTO)
        .annotate(priority_rank=selectors.priority_rank_expression())
    )
    overdue = base.filter(OPEN, due_at__lt=now).exclude(due_at__gte=start).order_by("due_at")[:50]
    due_today = base.filter(OPEN, due_at__gte=start, due_at__lt=end).order_by("priority_rank", "due_at")[:100]
    # "Focus": high priority open tasks without a date, so they don't fall through the cracks.
    focus = (
        base.filter(OPEN, due_at__isnull=True, owner=user, is_ongoing=False)
        .filter(priority__in=["critical", "high"])
        .order_by("priority_rank", "-updated_at")[:10]
    )
    # Long-term work: ticked daily, lives until the user completes it for good.
    ongoing = list(base.filter(OPEN, is_ongoing=True).order_by("today_checked", "priority_rank", "-updated_at")[:30])
    ongoing_ctx = {**ctx, "checkin_streaks": task_services.checkin_streaks([t.pk for t in ongoing], day)}
    # Personal / business lists without a project, so the dashboard shows the whole plate, not only dated work.
    plate = base.filter(OPEN, project__isnull=True, is_ongoing=False).order_by(
        "priority_rank", models_f_nulls_last("due_at"), "-updated_at"
    )
    personal = plate.filter(kind=Task.Kind.PERSONAL)[:8]
    business = plate.filter(kind=Task.Kind.BUSINESS)[:8]
    # Calendar: what is due over the next seven days after today.
    upcoming = base.filter(OPEN, due_at__gte=end, due_at__lt=end + timedelta(days=7)).order_by("due_at")[:40]
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

    # Every project that still has something to do; a project with zero open tasks is noise on the dashboard.
    # The user arranges these by hand (drag & drop -> sort_order); recently touched projects break ties.
    # No cap: the dashboard list scrolls, and the order the user set is the order they plan the day by.
    active_projects = list(
        Project.objects.visible_to(user)
        .with_progress(user)
        .filter(status__in=[Project.Status.ACTIVE, Project.Status.PAUSED], task_open__gt=0)
        .order_by("sort_order", "-updated_at")
        .values(
            "id", "name", "priority", "kind", "category", "status", "deadline", "task_total", "task_done", "task_open"
        )
    )
    project_ids = [p["id"] for p in active_projects]
    next_tasks: dict[int, list[dict]] = {pid: [] for pid in project_ids}
    if project_ids:
        # Up to five next open tasks per project so the card shows what is actually pending.
        rows = (
            base.filter(OPEN, project_id__in=project_ids)
            .order_by("project_id", "priority_rank", "due_at", "id")
            .values("id", "project_id", "title", "priority", "due_at", "status")
        )
        for row in rows:
            bucket = next_tasks[row["project_id"]]
            if len(bucket) < 5:
                bucket.append(row)
    for project in active_projects:
        project["next_tasks"] = next_tasks.get(project["id"], [])

    rules = list(Rule.objects.filter(owner=user, is_enabled=True))
    rule_ctx = {
        "rule_completions": routine_services.rule_completions_for_day(user, day),
        "rule_streaks": routine_services.rule_streaks(user, day),
    }

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
            "ongoing": TaskSerializer(ongoing, many=True, context=ongoing_ctx).data,
            "personal": TaskSerializer(personal, many=True, context=ctx).data,
            "business": TaskSerializer(business, many=True, context=ctx).data,
            "upcoming": TaskSerializer(upcoming, many=True, context=ctx).data,
            "completed": TaskSerializer(completed, many=True, context=ctx).data,
        },
        "routine": {
            # True on a weekend day when the everyday routine is off (Preferences); rules still count.
            "paused": routine_services.routine_paused_on(user, day),
            "current_item_id": current_item.pk if current_item else None,
            "business": RoutineItemSerializer(business_items, many=True, context=routine_ctx).data,
            "personal": RoutineItemSerializer(personal_items, many=True, context=routine_ctx).data,
        },
        "rules": RuleSerializer(rules, many=True, context=rule_ctx).data,
        "active_projects": active_projects,
    }
