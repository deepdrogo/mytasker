"""Celery tasks: outbound delivery (idempotent), inbound update processing, beat-driven reminders and summaries."""

from __future__ import annotations

import logging
from datetime import datetime, time, timedelta

from celery import shared_task
from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from apps.telegram import services
from apps.telegram.client import TelegramError, client
from apps.telegram.models import TelegramConnection, TelegramUpdateLog
from common.tz import now_for, today_for

logger = logging.getLogger("mytasker.telegram")


@shared_task(
    name="apps.telegram.tasks.send_delivery",
    bind=True,
    autoretry_for=(TelegramError,),
    retry_backoff=5,
    retry_backoff_max=600,
    retry_jitter=True,
    retry_kwargs={"max_retries": 5},
)
def send_delivery(self, delivery_id: int) -> str:
    return services.perform_send(delivery_id)


@shared_task(name="apps.telegram.tasks.process_update", bind=True, max_retries=2)
def process_update(self, update: dict) -> None:
    from apps.telegram import commands

    update_id = update.get("update_id")
    try:
        if "callback_query" in update:
            _handle_callback(update["callback_query"], commands)
        elif "message" in update:
            _handle_message(update["message"], commands)
    except Exception:  # noqa: BLE001
        logger.exception("telegram update failed", extra={"update_id": update_id})
        raise
    finally:
        if isinstance(update_id, int):
            TelegramUpdateLog.objects.filter(update_id=update_id).update(handled=True)


def _handle_message(message: dict, commands) -> None:
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    text = (message.get("text") or "").strip()
    if chat_id is None or not text:
        return
    sender = message.get("from") or {}

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        token = parts[1].strip() if len(parts) > 1 else ""
        if token:
            try:
                connection = services.complete_linking(
                    token,
                    chat_id=chat_id,
                    telegram_user_id=sender.get("id"),
                    username=sender.get("username", ""),
                    first_name=sender.get("first_name", ""),
                )
            except Exception as exc:  # noqa: BLE001
                _reply_raw(chat_id, f"⚠️ {services.escape(getattr(exc, 'message', 'Could not link this chat.'))}")
                return
            reply, markup = commands.cmd_start(connection.user, "")
            services.send_now(connection.user, reply, reply_markup=markup, key=f"start:{chat_id}:{connection.pk}")
            _register_commands()
            return

    user = services.user_for_chat(chat_id)
    if user is None:
        _reply_raw(
            chat_id,
            "This chat isn't linked to a MyTasker account yet.\n"
            "Open <b>Settings → Telegram</b> in the app and tap “Connect”.",
        )
        return
    reply, markup = commands.handle_text(user, text)
    services.send_now(user, reply, reply_markup=markup, key=f"msg:{chat_id}:{message.get('message_id')}")


def _handle_callback(callback: dict, commands) -> None:
    message = callback.get("message") or {}
    chat_id = (message.get("chat") or {}).get("id")
    callback_id = callback.get("id")
    user = services.user_for_chat(chat_id) if chat_id is not None else None
    if user is None:
        if callback_id:
            _safe(lambda: client.answer_callback_query(callback_id, "Not linked."))
        return
    text, markup, toast = commands.handle_callback(user, callback.get("data", ""))
    if callback_id:
        _safe(lambda: client.answer_callback_query(callback_id, toast))
    if message.get("message_id"):
        try:
            client.edit_message_text(chat_id, message["message_id"], text, reply_markup=markup)
            return
        except TelegramError as exc:
            if "message is not modified" in str(exc):
                return
    services.send_now(user, text, reply_markup=markup, key=f"cb:{chat_id}:{callback_id}")


def _reply_raw(chat_id: int, text: str) -> None:
    _safe(lambda: client.send_message(chat_id, text))


def _safe(fn) -> None:
    try:
        fn()
    except TelegramError as exc:
        logger.warning("telegram call failed: %s", exc)


_commands_registered = False


def _register_commands() -> None:
    global _commands_registered
    if _commands_registered or not client.configured:
        return
    from apps.telegram.commands import BOT_COMMANDS

    _safe(lambda: client.set_my_commands(BOT_COMMANDS))
    _commands_registered = True


# ----------------------------------------------------------------- beat: reminders


@shared_task(name="apps.telegram.tasks.dispatch_due_reminders")
def dispatch_due_reminders() -> int:
    """Every minute: fire pending reminders whose time has come (idempotent via status flip)."""
    from apps.tasks.models import Reminder
    from common.actors import Actor
    from common.events import DomainEvent, EventName, emit
    from common.models import Visibility

    now = timezone.now()
    count = 0
    ids = list(
        Reminder.objects.filter(status=Reminder.Status.PENDING, remind_at__lte=now).values_list("id", flat=True)[:500]
    )
    for reminder_id in ids:
        with transaction.atomic():
            reminder = (
                Reminder.objects.select_for_update(of=("self",), skip_locked=True)
                .select_related("task", "task__project", "user")
                .filter(pk=reminder_id, status=Reminder.Status.PENDING)
                .first()
            )
            if reminder is None:
                continue
            task = reminder.task
            if task is not None and (task.deleted_at or task.status in ("done", "cancelled")):
                reminder.status = Reminder.Status.CANCELLED
                reminder.save(update_fields=["status"])
                continue
            reminder.status = Reminder.Status.SENT
            reminder.sent_at = now
            reminder.save(update_fields=["status", "sent_at"])
            if task is not None:
                task.reminder_sent_at = now
                task.save(update_fields=["reminder_sent_at"])
            emit(
                DomainEvent(
                    name=EventName.REMINDER_DUE,
                    actor=Actor.system(),
                    target_type="task" if task is not None else "reminder",
                    target_id=task.pk if task is not None else reminder.pk,
                    owner_user_id=reminder.user_id,
                    project_id=None,
                    visibility=Visibility.PRIVATE,
                    payload={
                        "task_id": task.pk if task else None,
                        "title": task.title if task else reminder.message,
                        "message": reminder.message if task else "",
                        "kind": task.kind if task else "",
                        "due_at": task.due_at.isoformat() if task and task.due_at else "",
                    },
                )
            )
            count += 1
    return count


# ----------------------------------------------------------------- beat: summaries

SUMMARY_WINDOW = timedelta(minutes=15)


def _in_window(local_now: datetime, target: time) -> bool:
    start = local_now.replace(hour=target.hour, minute=target.minute, second=0, microsecond=0)
    return start <= local_now < start + SUMMARY_WINDOW


def _linked_users():
    user_model = get_user_model()
    return (
        user_model.objects.filter(
            is_active=True, telegram_connection__chat_id__isnull=False, telegram_connection__is_active=True
        )
        .select_related("preferences", "telegram_connection")
        .iterator()
    )


@shared_task(name="apps.telegram.tasks.dispatch_summaries")
def dispatch_summaries() -> int:
    """
    Every 15 minutes. For each linked user, send whichever summaries fall into the current local
    window. Idempotency keys include the local date so a re-run never double-sends.
    """
    from apps.notifications.models import Notification
    from apps.notifications.services import create_notification
    from apps.telegram.summaries import evening_summary, monthly_summary, morning_summary, weekly_summary

    sent = 0
    for user in _linked_users():
        prefs = getattr(user, "preferences", None)
        if prefs is None:
            continue
        local_now = now_for(user)
        today = local_now.date()
        yesterday = today - timedelta(days=1)
        morning_window = _in_window(local_now, prefs.morning_summary_time)
        # Weekly: on the user's first day of week, at the morning summary time.
        first_dow = int(getattr(prefs, "first_day_of_week", 1))
        weekday_is_first = (today.weekday() + 1) % 7 == first_dow  # convert Mon=0 → Sun=0 scale

        def send(kind: str, text: str, *, _user=user, _today=today) -> None:
            nonlocal sent
            if services.queue_message(_user, text=text, idempotency_key=f"{kind}:{_user.pk}:{_today}"):
                sent += 1

        try:
            if prefs.morning_summary_enabled and morning_window:
                send("morning", morning_summary(user))
            if prefs.evening_summary_enabled and _in_window(local_now, prefs.evening_summary_time):
                send("evening", evening_summary(user))
                create_notification(
                    user,
                    title="Evening review is ready",
                    body="",
                    url="/insights/daily",
                    category=Notification.Category.SUMMARY,
                    dedupe_key=f"evening:{today}",
                )
            if prefs.weekly_review_enabled and weekday_is_first and morning_window:
                send("weekly", weekly_summary(user, yesterday))
            if prefs.monthly_review_enabled and today.day == 1 and morning_window:
                send("monthly", monthly_summary(user, yesterday))
        except Exception:  # noqa: BLE001
            logger.exception("summary dispatch failed for user %s", user.pk)
    return sent


@shared_task(name="apps.telegram.tasks.cleanup_update_log")
def cleanup_update_log() -> int:
    cutoff = timezone.now() - timedelta(days=3)
    deleted, _ = TelegramUpdateLog.objects.filter(created_at__lt=cutoff).delete()
    TelegramConnection.objects.filter(link_expires_at__lt=timezone.now()).exclude(link_token_hash="").update(
        link_token_hash="", link_expires_at=None
    )
    return deleted


def user_today(user):
    return today_for(user)
