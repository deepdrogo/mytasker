"""Telegram linking + idempotent outbound delivery."""

from __future__ import annotations

import hashlib
import html
import logging
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.telegram.client import TelegramError, client
from apps.telegram.models import TelegramConnection, TelegramDelivery
from common.exceptions import Conflict, NotFound, ValidationFailed

logger = logging.getLogger("mytasker.telegram")


def escape(text: str) -> str:
    return html.escape(str(text or ""), quote=False)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


# ----------------------------------------------------------------- linking


def connection_for(user) -> TelegramConnection:
    connection, _ = TelegramConnection.objects.get_or_create(user=user)
    return connection


def linked_connection(user) -> TelegramConnection | None:
    connection = TelegramConnection.objects.filter(user=user).first()
    return connection if connection and connection.is_linked else None


@transaction.atomic
def start_linking(user) -> dict:
    """Generate a one-time /start token. Returns deep link + raw token (never stored)."""
    connection = connection_for(user)
    if connection.is_linked:
        raise Conflict("Telegram is already linked.", code="telegram_linked")
    token = secrets.token_urlsafe(24)
    connection.link_token_hash = _hash(token)
    connection.link_expires_at = timezone.now() + timedelta(seconds=settings.TELEGRAM_LINK_TOKEN_TTL_SECONDS)
    connection.save(update_fields=["link_token_hash", "link_expires_at", "updated_at"])
    username = settings.TELEGRAM_BOT_USERNAME.lstrip("@")
    return {
        "token": token,
        "expires_at": connection.link_expires_at,
        "deep_link": f"https://t.me/{username}?start={token}" if username else "",
        "bot_username": username,
    }


@transaction.atomic
def complete_linking(token: str, *, chat_id: int, telegram_user_id: int | None, username: str, first_name: str):
    if not token:
        raise ValidationFailed("Missing link token.")
    connection = (
        TelegramConnection.objects.select_for_update()
        .filter(link_token_hash=_hash(token), link_expires_at__gt=timezone.now())
        .select_related("user")
        .first()
    )
    if connection is None:
        raise NotFound("This link code is invalid or expired.")
    # A chat can only be linked to one account: unlink any previous owner of this chat_id.
    TelegramConnection.objects.filter(chat_id=chat_id).exclude(pk=connection.pk).update(
        chat_id=None, linked_at=None, is_active=False
    )
    connection.chat_id = chat_id
    connection.telegram_user_id = telegram_user_id
    connection.username = (username or "")[:64]
    connection.first_name = (first_name or "")[:120]
    connection.linked_at = timezone.now()
    connection.is_active = True
    connection.link_token_hash = ""
    connection.link_expires_at = None
    connection.last_interaction_at = timezone.now()
    connection.save()
    return connection


@transaction.atomic
def unlink(user) -> None:
    TelegramConnection.objects.filter(user=user).update(
        chat_id=None, telegram_user_id=None, linked_at=None, is_active=False, link_token_hash="", link_expires_at=None
    )


def is_private_chat(chat: dict | None) -> bool:
    """The bot only ever acts on behalf of an account inside a 1:1 chat. Groups/channels are refused, so a
    linked account can never be driven by other members of a group the owner happens to be in."""
    chat_type = (chat or {}).get("type")
    return chat_type in (None, "private")


def user_for_chat(chat_id: int, *, sender_id: int | None = None):
    connection = TelegramConnection.objects.filter(chat_id=chat_id, is_active=True).select_related("user").first()
    if connection is None or not connection.is_linked:
        return None
    # Defence in depth: once we know which Telegram user linked this chat, only that user may issue commands.
    if sender_id is not None and connection.telegram_user_id and connection.telegram_user_id != sender_id:
        return None
    if not connection.user.is_active:
        return None
    TelegramConnection.objects.filter(pk=connection.pk).update(last_interaction_at=timezone.now())
    return connection.user


# ----------------------------------------------------------------- outbound


def queue_message(
    user,
    *,
    text: str,
    idempotency_key: str,
    reply_markup: dict | None = None,
    notification=None,
    activity_event=None,
    parse_mode: str = "HTML",
) -> TelegramDelivery | None:
    """
    Create a delivery row and enqueue the Celery send. Returns None when the user is not linked.
    Duplicate idempotency keys return the existing row without re-sending.
    """
    connection = linked_connection(user)
    if connection is None:
        return None
    delivery, created = TelegramDelivery.objects.get_or_create(
        idempotency_key=idempotency_key[:160],
        defaults={
            "user": user,
            "chat_id": connection.chat_id,
            "text": text,
            "parse_mode": parse_mode,
            "reply_markup": reply_markup,
            "notification": notification,
            "activity_event": activity_event,
        },
    )
    if created:
        from apps.telegram.tasks import send_delivery

        transaction.on_commit(lambda: send_delivery.delay(delivery.pk))
    return delivery


def send_now(user, text: str, *, reply_markup: dict | None = None, key: str | None = None) -> TelegramDelivery | None:
    """Synchronous reply used inside webhook handling (already off the request path via Celery or fast path)."""
    key = key or f"direct:{user.pk}:{secrets.token_hex(8)}"
    delivery = queue_message(user, text=text, idempotency_key=key, reply_markup=reply_markup)
    return delivery


def perform_send(delivery_id: int) -> str:
    """
    Idempotent send. Locks the row; anything already delivered/sending is skipped so Celery retries
    or duplicate enqueues can never double-post.
    """
    with transaction.atomic():
        delivery = TelegramDelivery.objects.select_for_update(skip_locked=True).filter(pk=delivery_id).first()
        if delivery is None:
            return "missing"
        if delivery.status in (TelegramDelivery.Status.DELIVERED, TelegramDelivery.Status.SKIPPED):
            return delivery.status
        if delivery.status == TelegramDelivery.Status.SENDING:
            return "in_progress"
        delivery.status = TelegramDelivery.Status.SENDING
        delivery.attempts += 1
        delivery.save(update_fields=["status", "attempts", "updated_at"])

    try:
        if not client.configured:
            raise TelegramError("bot not configured", permanent=True)
        result = client.send_message(
            delivery.chat_id, delivery.text, parse_mode=delivery.parse_mode, reply_markup=delivery.reply_markup
        )
    except TelegramError as exc:
        status = (
            TelegramDelivery.Status.FAILED
            if exc.permanent or delivery.attempts >= 5
            else TelegramDelivery.Status.RETRYING
        )
        TelegramDelivery.objects.filter(pk=delivery.pk).update(status=status, last_error=str(exc)[:300])
        if exc.permanent and exc.status_code == 403:
            # User blocked the bot: stop trying for this chat.
            TelegramConnection.objects.filter(chat_id=delivery.chat_id).update(is_active=False)
        if status == TelegramDelivery.Status.RETRYING:
            raise
        return status

    TelegramDelivery.objects.filter(pk=delivery.pk).update(
        status=TelegramDelivery.Status.DELIVERED,
        telegram_message_id=(result or {}).get("message_id"),
        delivered_at=timezone.now(),
        last_error="",
    )
    return TelegramDelivery.Status.DELIVERED
