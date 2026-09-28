# MyTasker — daily check-ins from the project calendar.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""
Daily check-ins: whatever the project calendar puts on a day (a scheduled project, or the Crypto world
span) shows up that day to be ticked once. Only ticks are stored; the schedule is read from the calendar.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.accounts.models import UserPreference
from apps.projects.models import DailyCheckin, Project
from common.exceptions import NotFound, ValidationFailed
from common.tz import today_for

CRYPTO_KEY = "crypto"
HISTORY_MAX_DAYS = 92
STREAK_LOOKBACK_DAYS = 366
# Finished or shelved projects may keep their bar on the calendar, but no longer ask for a daily tick.
INACTIVE = (Project.Status.COMPLETED, Project.Status.ARCHIVED)


@dataclass(frozen=True)
class CalendarLine:
    key: str
    subject: str
    label: str
    project: Project | None
    start: date
    end: date | None

    def covers(self, day: date) -> bool:
        return is_workday(day) and self.start <= day and (self.end is None or self.end >= day)


def is_workday(day: date) -> bool:
    """The calendar breaks every bar on Saturday and Sunday, so weekends never ask for a check-in."""
    return day.weekday() < 5


def _previous_workday(day: date) -> date:
    day -= timedelta(days=1)
    while not is_workday(day):
        day -= timedelta(days=1)
    return day


def calendar_lines(user, start: date, end: date) -> list[CalendarLine]:
    """Calendar lines touching [start, end]: projects in calendar order, then Crypto world."""
    projects = (
        Project.objects.visible_to(user)
        .filter(start_date__isnull=False, start_date__lte=end)
        .filter(Q(deadline__isnull=True) | Q(deadline__gte=start))
        .exclude(status__in=INACTIVE)
        .order_by("start_date", "name")
    )
    lines = [
        CalendarLine(f"p{p.pk}", DailyCheckin.Subject.PROJECT, p.name, p, p.start_date, p.deadline) for p in projects
    ]
    # Read fresh: a cached `user.preferences` can predate the timeline edit that just moved Crypto world.
    crypto_start, crypto_end = UserPreference.objects.filter(user=user).values_list(
        "crypto_world_start", "crypto_world_end"
    ).first() or (None, None)
    if crypto_start and crypto_start <= end and (crypto_end is None or crypto_end >= start):
        crypto = DailyCheckin.Subject.CRYPTO
        lines.append(CalendarLine(CRYPTO_KEY, crypto, "Crypto world", None, crypto_start, crypto_end))
    return lines


def _key(row: DailyCheckin) -> str:
    if row.subject == DailyCheckin.Subject.CRYPTO:
        return CRYPTO_KEY
    # A deleted project keeps its ticks (project is NULL); give each its own key so they never merge.
    return f"p{row.project_id}" if row.project_id else f"gone{row.pk}"


def _streak(ticked: set[date], day: date) -> int:
    """
    Consecutive ticked workdays ending on `day`, or on the workday before while today is still open.
    Weekends are not on the calendar, so Friday and Monday count as neighbours.
    """
    cursor = day if day in ticked else _previous_workday(day)
    count = 0
    while cursor in ticked:
        count += 1
        cursor = _previous_workday(cursor)
    return count


def _project_ref(project: Project | None) -> dict[str, Any] | None:
    if project is None:
        return None
    return {"id": project.pk, "name": project.name, "priority": project.priority, "category": project.category}


def daily_checkins(user, day: date | None = None) -> list[dict[str, Any]]:
    """What the calendar puts on `day` (default: today), each with its tick and streak."""
    day = day or today_for(user)
    lines = [line for line in calendar_lines(user, day, day) if line.covers(day)]
    rows = DailyCheckin.objects.filter(
        user=user, date__gt=day - timedelta(days=STREAK_LOOKBACK_DAYS), date__lte=day
    ).only("pk", "date", "subject", "project_id", "created_at")
    ticked: dict[str, set[date]] = {}
    checked_at: dict[str, Any] = {}
    for row in rows:
        key = _key(row)
        ticked.setdefault(key, set()).add(row.date)
        if row.date == day:
            checked_at[key] = row.created_at
    return [
        {
            "key": line.key,
            "subject": line.subject,
            "label": line.label,
            "project": _project_ref(line.project),
            "start": line.start,
            "end": line.end,
            "checked": line.key in checked_at,
            "checked_at": checked_at.get(line.key),
            "streak": _streak(ticked.get(line.key, set()), day),
        }
        for line in lines
    ]


def set_checkin(
    user, *, day: date | None = None, project_id: int | None = None, crypto: bool = False, checked: bool = True
) -> dict[str, Any] | None:
    """Tick (or untick) one calendar line for a day. Only today or earlier, and only what was scheduled."""
    today = today_for(user)
    day = day or today
    if day > today:
        raise ValidationFailed("Check-ins are for today or earlier.", fields={"date": ["In the future."]})
    key = CRYPTO_KEY if crypto else f"p{project_id}"
    lookup: dict[str, Any] = {"user": user, "date": day}
    lookup.update({"subject": DailyCheckin.Subject.CRYPTO} if crypto else {"project_id": project_id})

    if not checked:
        DailyCheckin.objects.filter(**lookup).delete()
    else:
        line = next((item for item in calendar_lines(user, day, day) if item.key == key and item.covers(day)), None)
        if line is None:
            if not crypto and not Project.objects.visible_to(user).filter(pk=project_id).exists():
                raise NotFound("Project not found.")
            raise ValidationFailed("That is not on your calendar for this day.")
        try:
            with transaction.atomic():
                DailyCheckin.objects.get_or_create(**lookup, defaults={"subject": line.subject, "label": line.label})
        except IntegrityError:  # a double click from two tabs: already ticked
            pass
    return next((item for item in daily_checkins(user, day) if item["key"] == key), None)


def history(user, days: int = 30) -> dict[str, Any]:
    """
    The last `days` days, newest first: every line the calendar put on each day with its tick, plus
    per-line totals. Ticks for lines since taken off the calendar still show - they happened.
    """
    days = max(1, min(int(days), HISTORY_MAX_DAYS))
    end = today_for(user)
    start = end - timedelta(days=days - 1)
    lines = calendar_lines(user, start, end)
    ticked = {
        (row.date, _key(row)): row
        for row in DailyCheckin.objects.filter(user=user, date__gte=start, date__lte=end).select_related("project")
    }
    totals: dict[str, dict[str, Any]] = {}
    out = []

    def add(items: list[dict[str, Any]], key: str, label: str, project_id: int | None, subject: str, done: bool):
        items.append({"key": key, "label": label, "project_id": project_id, "subject": subject, "checked": done})
        entry = totals.setdefault(
            key, {"key": key, "label": label, "project_id": project_id, "subject": subject, "done": 0, "scheduled": 0}
        )
        entry["scheduled"] += 1
        entry["done"] += int(done)

    for offset in range(days):
        day = end - timedelta(days=offset)
        items: list[dict[str, Any]] = []
        for line in lines:
            if line.covers(day):
                project_id = line.project.pk if line.project else None
                add(items, line.key, line.label, project_id, line.subject, (day, line.key) in ticked)
        shown = {item["key"] for item in items}
        for (ticked_day, key), row in ticked.items():
            if ticked_day == day and key not in shown:
                add(items, key, row.project.name if row.project else row.label, row.project_id, row.subject, True)
        done = sum(item["checked"] for item in items)
        out.append({"date": day, "done": done, "total": len(items), "items": items})

    return {
        "start": start,
        "end": end,
        "days": out,
        "lines": sorted(totals.values(), key=lambda entry: entry["label"].lower()),
    }
