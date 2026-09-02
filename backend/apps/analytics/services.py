# MyTasker — analytics and daily rollups.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""
Analytics: live "today" snapshot + DailySummary rollups.

Design:
* Today is always computed from raw data (it changes constantly).
* Past days are materialised into DailySummary rows (idempotent upsert) by Celery and
  lazily backfilled here when a review requests a day that has no row yet.
* Weekly/monthly reviews aggregate DailySummary rows - never raw tables.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from apps.analytics.models import DailySummary
from apps.projects.models import Project
from apps.routines import services as routine_services
from apps.tasks.models import Task
from apps.time_tracking import services as time_services
from common.models import Source
from common.tz import day_bounds, month_bounds, today_for, week_bounds


@dataclass
class DayMetrics:
    date: date
    tasks_planned: int = 0
    tasks_completed: int = 0
    tasks_missed: int = 0
    personal_completed: int = 0
    business_completed: int = 0
    team_completed: int = 0
    guest_completed: int = 0
    business_minutes: int = 0
    personal_minutes: int = 0
    business_target_minutes: int = 0
    sleep_minutes: int = 0
    sleep_target_minutes: int = 0
    routine_items_total: int = 0
    routine_items_completed: int = 0
    project_minutes: dict[str, int] = field(default_factory=dict)

    @property
    def completion_rate(self) -> float:
        return round(self.tasks_completed / self.tasks_planned * 100, 1) if self.tasks_planned else 0.0

    @property
    def routine_rate(self) -> float:
        if not self.routine_items_total:
            return 0.0
        return round(self.routine_items_completed / self.routine_items_total * 100, 1)

    def as_dict(self) -> dict:
        data = asdict(self)
        data["completion_rate"] = self.completion_rate
        data["routine_rate"] = self.routine_rate
        data["business_target_pct"] = (
            round(self.business_minutes / self.business_target_minutes * 100) if self.business_target_minutes else 0
        )
        return data


def _prefs(user):
    return getattr(user, "preferences", None)


def compute_day(user, day: date) -> DayMetrics:
    """Compute every metric for one local day from raw data."""
    start, end = day_bounds(user, day)
    now = timezone.now()
    m = DayMetrics(date=day)

    own = Task.objects.filter(owner=user, parent__isnull=True)
    # Planned = tasks that were due on that day (or overdue carried into it and still open at end of day).
    planned = own.filter(due_at__gte=start, due_at__lt=end)
    m.tasks_planned = planned.count()
    completed = Task.objects.filter(completed_at__gte=start, completed_at__lt=end, parent__isnull=True).filter(
        Q(owner=user) | Q(completed_by=user)
    )
    agg = completed.aggregate(
        total=Count("id", distinct=True),
        personal=Count("id", filter=Q(owner=user, kind=Task.Kind.PERSONAL), distinct=True),
        business=Count("id", filter=Q(owner=user, kind=Task.Kind.BUSINESS), distinct=True),
        team=Count("id", filter=Q(project__isnull=False) & ~Q(completed_by=user), distinct=True),
        guest=Count("id", filter=Q(completion_source=Source.SHARE_LINK), distinct=True),
    )
    m.tasks_completed = agg["total"]
    m.personal_completed = agg["personal"]
    m.business_completed = agg["business"]
    m.team_completed = agg["team"]
    m.guest_completed = agg["guest"]
    # Missed = due that day and not done by the end of it (for today: not done yet and already past due).
    missed_cutoff = min(end, now)
    m.tasks_missed = (
        planned.filter(due_at__lt=missed_cutoff).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED]).count()
    )

    totals = time_services.totals_for_window(user, start, end)
    m.business_minutes = totals["business"] // 60
    m.personal_minutes = totals["personal"] // 60
    m.project_minutes = {str(pid): secs // 60 for pid, secs in totals["by_project"].items()}
    m.sleep_minutes = time_services.sleep_seconds_for_window(user, start, end) // 60

    prefs = _prefs(user)
    m.business_target_minutes = int(getattr(prefs, "business_hours_target_minutes", 600) or 0)
    m.sleep_target_minutes = int(getattr(prefs, "sleep_target_minutes", 480) or 0)

    items = routine_services.items_for_day(user, None, day)
    completions = routine_services.completions_for_day(user, day)
    m.routine_items_total = len(items)
    m.routine_items_completed = sum(
        1 for item in items if completions.get(item.pk) and completions[item.pk].completed
    )
    return m


@transaction.atomic
def upsert_summary(user, day: date) -> DailySummary:
    m = compute_day(user, day)
    data = m.as_dict()
    data.pop("date")
    data.pop("completion_rate")
    data.pop("routine_rate")
    data.pop("business_target_pct")
    summary, _ = DailySummary.objects.update_or_create(user=user, date=day, defaults=data)
    return summary


def summary_for(user, day: date, *, refresh: bool = False) -> DayMetrics:
    """Past days come from DailySummary (backfilled lazily); today is always live."""
    if day >= today_for(user) or refresh:
        return compute_day(user, day)
    row = DailySummary.objects.filter(user=user, date=day).first()
    if row is None:
        row = upsert_summary(user, day)
    return _from_row(row)


def _from_row(row: DailySummary) -> DayMetrics:
    return DayMetrics(
        date=row.date,
        tasks_planned=row.tasks_planned,
        tasks_completed=row.tasks_completed,
        tasks_missed=row.tasks_missed,
        personal_completed=row.personal_completed,
        business_completed=row.business_completed,
        team_completed=row.team_completed,
        guest_completed=row.guest_completed,
        business_minutes=row.business_minutes,
        personal_minutes=row.personal_minutes,
        business_target_minutes=row.business_target_minutes,
        sleep_minutes=row.sleep_minutes,
        sleep_target_minutes=row.sleep_target_minutes,
        routine_items_total=row.routine_items_total,
        routine_items_completed=row.routine_items_completed,
        project_minutes=dict(row.project_minutes or {}),
    )


def range_summaries(user, start_date: date, end_date: date) -> list[DayMetrics]:
    """Inclusive day range. Existing rows are loaded in one query; gaps are backfilled."""
    today = today_for(user)
    rows = {r.date: r for r in DailySummary.objects.filter(user=user, date__gte=start_date, date__lte=end_date)}
    out: list[DayMetrics] = []
    day = start_date
    while day <= end_date:
        if day > today:
            out.append(DayMetrics(date=day))
        elif day == today:
            out.append(compute_day(user, day))
        elif day in rows:
            out.append(_from_row(rows[day]))
        else:
            out.append(_from_row(upsert_summary(user, day)))
        day += timedelta(days=1)
    return out


def aggregate(days: list[DayMetrics]) -> dict:
    total = DayMetrics(date=days[0].date if days else date.today())
    projects: dict[str, int] = {}
    active_days = 0
    for d in days:
        total.tasks_planned += d.tasks_planned
        total.tasks_completed += d.tasks_completed
        total.tasks_missed += d.tasks_missed
        total.personal_completed += d.personal_completed
        total.business_completed += d.business_completed
        total.team_completed += d.team_completed
        total.guest_completed += d.guest_completed
        total.business_minutes += d.business_minutes
        total.personal_minutes += d.personal_minutes
        total.business_target_minutes += d.business_target_minutes
        total.sleep_minutes += d.sleep_minutes
        total.sleep_target_minutes += d.sleep_target_minutes
        total.routine_items_total += d.routine_items_total
        total.routine_items_completed += d.routine_items_completed
        for pid, minutes in d.project_minutes.items():
            projects[pid] = projects.get(pid, 0) + minutes
        if d.tasks_completed or d.business_minutes or d.personal_minutes:
            active_days += 1
    data = total.as_dict()
    data.pop("date")
    data["project_minutes"] = projects
    data["active_days"] = active_days
    data["avg_business_minutes"] = round(total.business_minutes / len(days)) if days else 0
    data["avg_sleep_minutes"] = (
        round(total.sleep_minutes / max(1, sum(1 for d in days if d.sleep_minutes))) if days else 0
    )
    return data


def project_labels(project_ids: list[int]) -> dict[str, str]:
    return {str(p.pk): p.name for p in Project.all_objects.filter(pk__in=project_ids).only("id", "name")}


def daily_review(user, day: date | None = None) -> dict:
    day = day or today_for(user)
    metrics = summary_for(user, day)
    previous = summary_for(user, day - timedelta(days=1))
    return {
        "date": day,
        "metrics": metrics.as_dict(),
        "previous": previous.as_dict(),
        "projects": project_labels([int(k) for k in metrics.project_minutes]),
    }


def weekly_review(user, anchor: date | None = None) -> dict:
    _, _, start_date, end_date = week_bounds(user, anchor)
    days = range_summaries(user, start_date, end_date)
    totals = aggregate(days)
    prev_days = range_summaries(user, start_date - timedelta(days=7), start_date - timedelta(days=1))
    return {
        "start_date": start_date,
        "end_date": end_date,
        "days": [d.as_dict() for d in days],
        "totals": totals,
        "previous_totals": aggregate(prev_days),
        "projects": project_labels([int(k) for k in totals["project_minutes"]]),
    }


def monthly_review(user, anchor: date | None = None) -> dict:
    _, _, start_date, end_date = month_bounds(user, anchor)
    days = range_summaries(user, start_date, end_date)
    totals = aggregate(days)
    prev_anchor = start_date - timedelta(days=1)
    _, _, pstart, pend = month_bounds(user, prev_anchor)
    prev = aggregate(range_summaries(user, pstart, pend))
    # Weekly buckets inside the month for the chart.
    weeks: list[dict] = []
    bucket: list[DayMetrics] = []
    for d in days:
        bucket.append(d)
        if len(bucket) == 7:
            weeks.append({"start_date": bucket[0].date, "end_date": bucket[-1].date, **aggregate(bucket)})
            bucket = []
    if bucket:
        weeks.append({"start_date": bucket[0].date, "end_date": bucket[-1].date, **aggregate(bucket)})
    return {
        "start_date": start_date,
        "end_date": end_date,
        "days": [d.as_dict() for d in days],
        "weeks": weeks,
        "totals": totals,
        "previous_totals": prev,
        "projects": project_labels([int(k) for k in totals["project_minutes"]]),
    }


def streak(user, upto: date | None = None, max_days: int = 365) -> int:
    """Consecutive days (ending today or yesterday) with at least one completed task."""
    today = upto or today_for(user)
    rows = dict(
        DailySummary.objects.filter(
            user=user, date__gte=today - timedelta(days=max_days), date__lt=today
        ).values_list("date", "tasks_completed")
    )
    live = compute_day(user, today).tasks_completed
    count = 0
    day = today
    if live > 0:
        count = 1
    day -= timedelta(days=1)
    while day in rows and rows[day] > 0 and count < max_days:
        count += 1
        day -= timedelta(days=1)
    return count
