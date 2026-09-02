"""
Telegram command + callback handlers. Every handler receives an authenticated MyTasker user
(resolved from chat_id) and returns (text, reply_markup). Free text that is not a command is routed
to the AI layer when configured, otherwise treated as quick-add.
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta

from django.db.models import Q
from django.utils import timezone

from apps.tasks import services as task_services
from apps.tasks.models import Task
from apps.telegram import keyboards
from apps.telegram.services import escape
from apps.telegram.summaries import evening_summary, morning_summary, weekly_summary
from apps.time_tracking import services as time_services
from common.actors import Actor
from common.dateparse import parse_when
from common.exceptions import DomainError
from common.tz import day_bounds, format_local

logger = logging.getLogger("mytasker.telegram")

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])

HELP = (
    "<b>MyTasker commands</b>\n"
    "/today — today's plan\n"
    "/add &lt;text&gt; — quick add (understands “tomorrow 15:00”, “!high”, “#business”)\n"
    "/done &lt;id or text&gt; — complete a task\n"
    "/list — open tasks with buttons\n"
    "/timer — start / stop the business timer\n"
    "/summary — evening review · /week — weekly review\n"
    "/unlink — disconnect this chat\n\n"
    "Or just write naturally: “remind me to call Nino tomorrow at 10”."
)

BOT_COMMANDS = [
    {"command": "today", "description": "Today's plan"},
    {"command": "add", "description": "Quick add a task"},
    {"command": "done", "description": "Complete a task"},
    {"command": "list", "description": "Open tasks"},
    {"command": "timer", "description": "Start/stop timer"},
    {"command": "summary", "description": "Evening review"},
    {"command": "week", "description": "Weekly review"},
    {"command": "help", "description": "Help"},
]


def _hm(seconds: int) -> str:
    h, m = divmod(int(seconds) // 60, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


def handle_text(user, text: str) -> tuple[str, dict | None]:
    text = (text or "").strip()
    if not text:
        return HELP, None
    if text.startswith("/"):
        parts = text.split(maxsplit=1)
        command = parts[0].lower().split("@")[0]
        arg = parts[1] if len(parts) > 1 else ""
        handler = COMMANDS.get(command)
        if handler is None:
            return "Unknown command. " + HELP, None
        try:
            return handler(user, arg)
        except DomainError as exc:
            return f"⚠️ {escape(exc.message)}", None
    return natural_language(user, text)


def natural_language(user, text: str) -> tuple[str, dict | None]:
    from apps.ai.access import ai_enabled_for

    # AI routing is an admin-only capability; everyone else gets the deterministic quick-add.
    if ai_enabled_for(user):
        try:
            from apps.ai.services import run_command

            result = run_command(Actor.telegram(user), text, source="telegram")
            markup = None
            if result.get("pending_action_id"):
                markup = keyboards.confirm_keyboard(result["pending_action_id"])
            return escape(result.get("reply") or "Done."), markup
        except Exception:  # noqa: BLE001 - fall back to deterministic quick-add
            logger.exception("telegram AI routing failed")
    return cmd_add(user, text)


# ----------------------------------------------------------------- commands


def cmd_start(user, arg: str) -> tuple[str, dict | None]:
    return f"Linked as <b>{escape(user.display_name)}</b> ✓\n\n" + HELP, None


def cmd_help(user, arg: str) -> tuple[str, dict | None]:
    return HELP, None


def cmd_today(user, arg: str) -> tuple[str, dict | None]:
    start, end = day_bounds(user)
    tasks = list(
        Task.objects.visible_to(user)
        .filter(OPEN, parent__isnull=True)
        .filter(Q(due_at__lt=end) | Q(priority="critical"))
        .order_by("due_at")[:12]
    )
    return morning_summary(user), keyboards.task_list_keyboard(tasks)


def cmd_list(user, arg: str) -> tuple[str, dict | None]:
    qs = Task.objects.visible_to(user).filter(OPEN, parent__isnull=True).order_by("due_at", "-priority")
    if arg.strip():
        qs = qs.filter(title__icontains=arg.strip())
    tasks = list(qs[:10])
    if not tasks:
        return "No open tasks. 🎉", None
    lines = ["<b>Open tasks</b>"]
    for t in tasks:
        due = f" · {format_local(t.due_at, user, '%d %b %H:%M' if t.due_has_time else '%d %b')}" if t.due_at else ""
        lines.append(f"<code>#{t.pk}</code> {escape(t.title)}{due}")
    return "\n".join(lines), keyboards.task_list_keyboard(tasks)


def cmd_add(user, arg: str) -> tuple[str, dict | None]:
    text = arg.strip()
    for prefix in ("remind me to ", "add task ", "add ", "todo "):
        if text.lower().startswith(prefix):
            text = text[len(prefix) :]
            break
    if not text:
        return "Usage: /add Call Nino tomorrow 15:00 !high #business", None
    kind = Task.Kind.PERSONAL
    priority = None
    if re.search(r"(^|\s)#business\b", text, re.I):
        kind = Task.Kind.BUSINESS
        text = re.sub(r"(^|\s)#business\b", " ", text, flags=re.I)
    text = re.sub(r"(^|\s)#personal\b", " ", text, flags=re.I)
    m = re.search(r"(^|\s)!(critical|high|normal|low|urgent)\b", text, re.I)
    if m:
        priority = m.group(2).lower().replace("urgent", "critical")
        text = text[: m.start()] + " " + text[m.end() :]
    parsed = parse_when(text, user)
    title = parsed.text.strip(" ,.-") or text.strip()
    fields = {}
    if parsed.due_at:
        fields["due_at"] = parsed.due_at
        fields["due_has_time"] = parsed.has_time
        if parsed.has_time:
            fields["reminder_at"] = parsed.due_at - timedelta(minutes=30)
    if priority:
        fields["priority"] = priority
    task = task_services.create_task(Actor.telegram(user), title=title[:300], kind=kind, **fields)
    when = ""
    if task.due_at:
        when = " · " + format_local(task.due_at, user, "%a %d %b %H:%M" if task.due_has_time else "%a %d %b")
    return f"✓ Added <b>{escape(task.title)}</b>{when}", keyboards.task_actions_keyboard(task.pk)


def _find_task(user, arg: str) -> Task | None:
    arg = arg.strip().lstrip("#")
    if not arg:
        return None
    qs = Task.objects.visible_to(user).filter(OPEN)
    if arg.isdigit():
        return qs.filter(pk=int(arg)).first()
    return qs.filter(title__icontains=arg).order_by("due_at").first()


def cmd_done(user, arg: str) -> tuple[str, dict | None]:
    task = _find_task(user, arg)
    if task is None:
        return "Couldn't find that task. Try /list.", None
    task = task_services.complete_task(Actor.telegram(user), task.pk)
    return f"✓ Completed <b>{escape(task.title)}</b>", keyboards.task_actions_keyboard(task.pk, done=True)


def cmd_timer(user, arg: str) -> tuple[str, dict | None]:
    running = time_services.running_entry(user)
    arg = arg.strip().lower()
    actor = Actor.telegram(user)
    if arg in ("stop", "off") and running:
        entry = time_services.stop_timer(actor)
        return f"■ Stopped · {_hm(entry.duration_seconds)} logged", keyboards.timer_keyboard(False)
    if arg in ("business", "personal", "start", "on"):
        category = arg if arg in ("business", "personal") else "business"
        entry = time_services.start_timer(actor, category=category)
        return f"▶ {category.title()} timer started", keyboards.timer_keyboard(True)
    if running:
        label = running.task.title if running.task_id else running.category.title()
        return f"⏱ Running: <b>{escape(label)}</b> · {_hm(running.current_seconds())}", keyboards.timer_keyboard(True)
    totals = time_services.today_totals(user)
    return f"No timer running. Today: business {_hm(totals['business'])}", keyboards.timer_keyboard(False)


def cmd_summary(user, arg: str) -> tuple[str, dict | None]:
    return evening_summary(user), None


def cmd_week(user, arg: str) -> tuple[str, dict | None]:
    return weekly_summary(user), None


def cmd_unlink(user, arg: str) -> tuple[str, dict | None]:
    from apps.telegram.services import unlink

    unlink(user)
    return "Disconnected. You can re-link from Settings → Telegram any time.", None


COMMANDS = {
    "/start": cmd_start,
    "/help": cmd_help,
    "/today": cmd_today,
    "/list": cmd_list,
    "/add": cmd_add,
    "/done": cmd_done,
    "/timer": cmd_timer,
    "/summary": cmd_summary,
    "/week": cmd_week,
    "/unlink": cmd_unlink,
}


# ----------------------------------------------------------------- callbacks


def handle_callback(user, data: str) -> tuple[str, dict | None, str]:
    """Returns (new_message_text, reply_markup, toast) for inline button presses."""
    parts = (data or "").split(":")
    verb = parts[0]
    actor = Actor.telegram(user)
    try:
        if verb == "done" and len(parts) == 2:
            task = task_services.complete_task(actor, int(parts[1]))
            return (
                f"✓ Completed <b>{escape(task.title)}</b>",
                keyboards.task_actions_keyboard(task.pk, done=True),
                "Done",
            )
        if verb == "reopen" and len(parts) == 2:
            task = task_services.reopen_task(actor, int(parts[1]))
            return f"↩ Reopened <b>{escape(task.title)}</b>", keyboards.task_actions_keyboard(task.pk), "Reopened"
        if verb == "snooze" and len(parts) == 3:
            task = task_services.snooze(actor, int(parts[1]), minutes=int(parts[2]))
            when = format_local(task.due_at, user, "%a %d %b %H:%M")
            return f"⏰ <b>{escape(task.title)}</b> → {when}", keyboards.task_actions_keyboard(task.pk), "Snoozed"
        if verb == "timer" and len(parts) == 2:
            entry = time_services.start_timer(actor, task_id=int(parts[1]))
            return (
                f"▶ Timer started · <b>{escape(entry.task.title)}</b>",
                keyboards.timer_keyboard(True),
                "Timer started",
            )
        if verb == "timer_start" and len(parts) == 2:
            time_services.start_timer(actor, category=parts[1])
            return f"▶ {parts[1].title()} timer started", keyboards.timer_keyboard(True), "Started"
        if verb == "timer_stop":
            entry = time_services.stop_timer(actor)
            return f"■ Stopped · {_hm(entry.duration_seconds)} logged", keyboards.timer_keyboard(False), "Stopped"
        if verb in ("ai_confirm", "ai_cancel") and len(parts) == 2:
            from apps.ai import services as ai
            from apps.ai.access import ai_allowed

            if not ai_allowed(user):
                return "⚠️ The AI assistant is available to administrators only.", None, "Admins only"
            if verb == "ai_confirm":
                result = ai.confirm_action(user, int(parts[1]))
                return escape(result.get("reply") or "Done."), None, "Confirmed"
            ai.reject_action(user, int(parts[1]))
            return "Cancelled.", None, "Cancelled"
    except DomainError as exc:
        return f"⚠️ {escape(exc.message)}", None, exc.message[:60]
    return "Unknown action.", None, ""


def now_label(user) -> str:
    return format_local(timezone.now(), user)
