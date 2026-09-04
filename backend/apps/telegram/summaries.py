"""Text builders for morning / evening / weekly / monthly Telegram summaries."""

from __future__ import annotations

from datetime import date, timedelta

from django.db.models import Q
from django.utils import timezone

from apps.analytics import services as analytics
from apps.tasks.models import Task
from apps.telegram.services import escape
from common.tz import day_bounds, format_local, today_for

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def _hm(minutes: int) -> str:
    h, m = divmod(int(minutes or 0), 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def _task_line(task: Task, user) -> str:
    due = ""
    if task.due_at and task.due_has_time:
        due = f" · {format_local(task.due_at, user)}"
    flag = " ‼" if task.priority in ("critical", "high") else ""
    return f"• {escape(task.title)}{due}{flag}"


def morning_summary(user) -> str:
    day = today_for(user)
    start, end = day_bounds(user, day)
    now = timezone.now()
    base = Task.objects.visible_to(user).filter(OPEN, parent__isnull=True).select_related("project")
    overdue = list(base.filter(due_at__lt=start).order_by("due_at")[:8])
    today = list(base.filter(due_at__gte=start, due_at__lt=end).order_by("due_at")[:12])
    focus = list(
        base.filter(due_at__isnull=True, owner=user, priority__in=["critical", "high"]).order_by("-updated_at")[:5]
    )
    lines = [f"☀️ <b>Good morning — {day.strftime('%a, %d %b')}</b>"]
    if today:
        lines.append(f"\n<b>Today ({len(today)})</b>")
        lines += [_task_line(t, user) for t in today]
    if overdue:
        lines.append(f"\n<b>Overdue ({len(overdue)})</b>")
        lines += [_task_line(t, user) for t in overdue]
    if focus:
        lines.append("\n<b>Focus</b>")
        lines += [_task_line(t, user) for t in focus]
    ongoing = list(base.filter(is_ongoing=True).order_by("-updated_at")[:8])
    if ongoing:
        lines.append("\n<b>Daily check-ins</b>")
        lines += [_task_line(t, user) for t in ongoing]
    if not (today or overdue or focus or ongoing):
        lines.append("\nNothing scheduled. A clean slate — pick one meaningful thing.")
    streak = analytics.streak(user, day - timedelta(days=1))
    if streak:
        lines.append(f"\n🔥 {streak}-day streak. Keep it alive.")
    del now
    return "\n".join(lines)


def evening_summary(user) -> str:
    day = today_for(user)
    m = analytics.compute_day(user, day)
    lines = [f"🌙 <b>Evening review — {day.strftime('%a, %d %b')}</b>", ""]
    lines.append(
        f"✓ Completed: <b>{m.tasks_completed}</b> (personal {m.personal_completed}, business {m.business_completed})"
    )
    if m.tasks_missed:
        lines.append(f"✗ Missed: <b>{m.tasks_missed}</b>")
    target = f" / {_hm(m.business_target_minutes)}" if m.business_target_minutes else ""
    lines.append(f"⏱ Business time: <b>{_hm(m.business_minutes)}</b>{target}")
    if m.personal_minutes:
        lines.append(f"⏱ Personal time: {_hm(m.personal_minutes)}")
    if m.routine_items_total:
        lines.append(f"🔁 Routine: {m.routine_items_completed}/{m.routine_items_total}")
    if m.sleep_minutes:
        lines.append(f"😴 Sleep: {_hm(m.sleep_minutes)}")
    start, end = day_bounds(user, day)
    left = Task.objects.visible_to(user).filter(OPEN, parent__isnull=True, due_at__gte=start, due_at__lt=end).count()
    if left:
        lines.append(f"\n{left} task{'s' if left != 1 else ''} still due today.")
    else:
        lines.append("\nEverything due today is done. Well played.")
    return "\n".join(lines)


def weekly_summary(user, anchor: date | None = None) -> str:
    review = analytics.weekly_review(user, anchor)
    t, p = review["totals"], review["previous_totals"]
    lines = [f"📅 <b>Weekly review — {review['start_date']:%d %b} → {review['end_date']:%d %b}</b>", ""]
    lines.append(f"✓ Completed <b>{t['tasks_completed']}</b> ({_delta(t['tasks_completed'], p['tasks_completed'])})")
    lines.append(f"✗ Missed {t['tasks_missed']}")
    lines.append(
        f"⏱ Business <b>{_hm(t['business_minutes'])}</b> ({_delta(t['business_minutes'], p['business_minutes'])})"
    )
    lines.append(f"📆 Active days {t['active_days']}/7 · avg {_hm(t['avg_business_minutes'])}/day")
    if t["routine_items_total"]:
        lines.append(f"🔁 Routine {t['routine_rate']}%")
    top = sorted(t["project_minutes"].items(), key=lambda kv: -kv[1])[:3]
    if top:
        lines.append("\n<b>Top projects</b>")
        for pid, minutes in top:
            lines.append(f"• {escape(review['projects'].get(pid, 'Project'))} — {_hm(minutes)}")
    return "\n".join(lines)


def monthly_summary(user, anchor: date | None = None) -> str:
    review = analytics.monthly_review(user, anchor)
    t, p = review["totals"], review["previous_totals"]
    lines = [f"🗓 <b>Monthly review — {review['start_date']:%B %Y}</b>", ""]
    lines.append(f"✓ Completed <b>{t['tasks_completed']}</b> ({_delta(t['tasks_completed'], p['tasks_completed'])})")
    lines.append(
        f"⏱ Business <b>{_hm(t['business_minutes'])}</b> ({_delta(t['business_minutes'], p['business_minutes'])})"
    )
    lines.append(f"📆 Active days {t['active_days']} · completion {t['completion_rate']}%")
    if t["avg_sleep_minutes"]:
        lines.append(f"😴 Avg sleep {_hm(t['avg_sleep_minutes'])}")
    top = sorted(t["project_minutes"].items(), key=lambda kv: -kv[1])[:5]
    if top:
        lines.append("\n<b>Where the time went</b>")
        for pid, minutes in top:
            lines.append(f"• {escape(review['projects'].get(pid, 'Project'))} — {_hm(minutes)}")
    return "\n".join(lines)


def _delta(current: int, previous: int) -> str:
    diff = current - previous
    if diff == 0:
        return "same as before"
    return f"{'+' if diff > 0 else ''}{diff} vs previous"
