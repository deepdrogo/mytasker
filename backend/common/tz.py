"""Timezone helpers. All DB timestamps are UTC; presentation boundaries use the user's timezone."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

DEFAULT_TZ = "UTC"


def user_zone(user) -> ZoneInfo:
    name = getattr(user, "timezone", None) or DEFAULT_TZ
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        return ZoneInfo(DEFAULT_TZ)


def now_for(user) -> datetime:
    return timezone.now().astimezone(user_zone(user))


def today_for(user) -> date:
    return now_for(user).date()


def day_bounds(user, day: date | None = None) -> tuple[datetime, datetime]:
    """Return UTC-aware (start, end) of the given local calendar day for the user."""
    zone = user_zone(user)
    day = day or today_for(user)
    start = datetime.combine(day, time.min, tzinfo=zone)
    end = start + timedelta(days=1)
    return start.astimezone(UTC), end.astimezone(UTC)


def week_bounds(user, day: date | None = None) -> tuple[datetime, datetime, date, date]:
    """(start_utc, end_utc, start_date, end_date) of the week containing `day`, honouring first_day_of_week."""
    day = day or today_for(user)
    first_dow = int(getattr(getattr(user, "preferences", None), "first_day_of_week", 1))  # 1 = Monday
    # Python weekday(): Monday=0..Sunday=6. first_dow: 0=Sunday, 1=Monday.
    offset = (day.weekday() - (first_dow - 1)) % 7
    start_date = day - timedelta(days=offset)
    end_date = start_date + timedelta(days=7)
    start, _ = day_bounds(user, start_date)
    end, _ = day_bounds(user, end_date)
    return start, end, start_date, end_date - timedelta(days=1)


def month_bounds(user, day: date | None = None) -> tuple[datetime, datetime, date, date]:
    day = day or today_for(user)
    start_date = day.replace(day=1)
    if start_date.month == 12:
        next_month = start_date.replace(year=start_date.year + 1, month=1)
    else:
        next_month = start_date.replace(month=start_date.month + 1)
    start, _ = day_bounds(user, start_date)
    end, _ = day_bounds(user, next_month)
    return start, end, start_date, next_month - timedelta(days=1)


def local_date(dt: datetime | None, user) -> date | None:
    if dt is None:
        return None
    return dt.astimezone(user_zone(user)).date()


def combine_local(day: date, t: time | None, user) -> datetime:
    zone = user_zone(user)
    local = datetime.combine(day, t or time(hour=23, minute=59), tzinfo=zone)
    return local.astimezone(UTC)


def format_local(dt: datetime | None, user, fmt: str | None = None) -> str:
    if dt is None:
        return ""
    prefs = getattr(user, "preferences", None)
    time_fmt = getattr(prefs, "time_format", "24h")
    pattern = fmt or ("%H:%M" if time_fmt == "24h" else "%I:%M %p")
    return dt.astimezone(user_zone(user)).strftime(pattern)
