"""
Server-side natural-language date parsing (English + a few Georgian words), timezone-aware.

The AI layer and Telegram quick-add both route through here so "tomorrow 15:00" means the same
thing everywhere and is resolved in the *user's* timezone, never the server's.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from common.tz import now_for, user_zone

WEEKDAYS = {
    "monday": 0, "mon": 0, "ორშაბათი": 0, "ორშაბათს": 0,
    "tuesday": 1, "tue": 1, "სამშაბათი": 1, "სამშაბათს": 1,
    "wednesday": 2, "wed": 2, "ოთხშაბათი": 2, "ოთხშაბათს": 2,
    "thursday": 3, "thu": 3, "ხუთშაბათი": 3, "ხუთშაბათს": 3,
    "friday": 4, "fri": 4, "პარასკევი": 4, "პარასკევს": 4,
    "saturday": 5, "sat": 5, "შაბათი": 5, "შაბათს": 5,
    "sunday": 6, "sun": 6, "კვირა": 6, "კვირას": 6,
}  # fmt: skip

TIME_RE = re.compile(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", re.IGNORECASE)
ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DMY_RE = re.compile(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b")
REL_RE = re.compile(r"\bin\s+(\d+)\s*(min|mins|minutes|h|hour|hours|d|day|days|week|weeks)\b", re.IGNORECASE)


@dataclass
class ParsedDate:
    due_at: datetime | None
    has_time: bool
    text: str  # input with the date phrase removed


def parse_when(text: str, user, *, default_time: time | None = None) -> ParsedDate:
    """Extract a due date/time from free text. Returns UTC datetime or None."""
    zone = user_zone(user)
    now = now_for(user)
    working = f" {text.strip()} "
    lowered = working.lower()
    day: date | None = None
    at: time | None = None
    has_time = False

    m = REL_RE.search(lowered)
    if m:
        amount, unit = int(m.group(1)), m.group(2)
        if unit.startswith(("min",)):
            target = now + timedelta(minutes=amount)
            return ParsedDate(target.astimezone(UTC), True, _cut(working, m))
        if unit.startswith("h"):
            target = now + timedelta(hours=amount)
            return ParsedDate(target.astimezone(UTC), True, _cut(working, m))
        day = now.date() + timedelta(days=amount * (7 if unit.startswith("week") else 1))
        working = _cut(working, m)
        lowered = working.lower()

    if day is None:
        for word, offset in (
            ("today", 0),
            ("დღეს", 0),
            ("tonight", 0),
            ("tomorrow", 1),
            ("ხვალ", 1),
            ("day after tomorrow", 2),
        ):
            idx = lowered.find(f" {word} ")
            if idx >= 0:
                day = now.date() + timedelta(days=offset)
                if word == "tonight":
                    at = time(20, 0)
                    has_time = True
                working = working[:idx] + " " + working[idx + len(word) + 2 :]
                lowered = working.lower()
                break

    if day is None:
        m = ISO_RE.search(lowered)
        if m:
            try:
                day = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
                working = _cut(working, m)
                lowered = working.lower()
            except ValueError:
                day = None
    if day is None:
        m = DMY_RE.search(lowered)
        if m and not TIME_RE.fullmatch(m.group(0)):
            d, mo = int(m.group(1)), int(m.group(2))
            year = int(m.group(3)) if m.group(3) else now.year
            if year < 100:
                year += 2000
            try:
                candidate = date(year, mo, d)
                if not m.group(3) and candidate < now.date():
                    candidate = date(year + 1, mo, d)
                day = candidate
                working = _cut(working, m)
                lowered = working.lower()
            except ValueError:
                day = None
    if day is None:
        for word, weekday in WEEKDAYS.items():
            for prefix in ("next ", "on ", ""):
                token = f" {prefix}{word} "
                idx = lowered.find(token)
                if idx >= 0:
                    delta = (weekday - now.weekday()) % 7
                    if delta == 0 or prefix == "next ":
                        delta = delta or 7
                    day = now.date() + timedelta(days=delta)
                    working = working[:idx] + " " + working[idx + len(token) :]
                    lowered = working.lower()
                    break
            if day is not None:
                break
    if day is None and " next week " in lowered:
        day = now.date() + timedelta(days=(7 - now.weekday()))
        working = working.replace(" next week ", " ").replace(" Next week ", " ")
        lowered = working.lower()

    m = TIME_RE.search(lowered)
    if m and (m.group(2) or m.group(3) or lowered[m.start() : m.start() + 3].strip().startswith("at")):
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
        meridiem = (m.group(3) or "").lower()
        if meridiem == "pm" and hour < 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        if 0 <= hour < 24 and 0 <= minute < 60:
            at = time(hour, minute)
            has_time = True
            working = _cut(working, m)
            if day is None:
                day = now.date()
                if datetime.combine(day, at, tzinfo=zone) <= now:
                    day += timedelta(days=1)

    if day is None:
        return ParsedDate(None, False, re.sub(r"\s+", " ", working).strip())

    local = datetime.combine(day, at or default_time or time(23, 59), tzinfo=zone)
    return ParsedDate(local.astimezone(UTC), has_time, re.sub(r"\s+", " ", working).strip())


def _cut(text: str, match: re.Match) -> str:
    return text[: match.start()] + " " + text[match.end() :]
