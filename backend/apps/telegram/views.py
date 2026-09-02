from __future__ import annotations

import hmac
import logging

from django.conf import settings
from django.db import IntegrityError
from rest_framework import status
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.telegram import services
from apps.telegram.models import TelegramConnection, TelegramDelivery, TelegramUpdateLog
from common.exceptions import Forbidden

logger = logging.getLogger("mytasker.telegram")


# ----------------------------------------------------------------- user-facing API


def _connection_payload(connection: TelegramConnection | None) -> dict:
    if connection is None:
        return {
            "linked": False,
            "bot_username": settings.TELEGRAM_BOT_USERNAME.lstrip("@"),
            "configured": bool(settings.TELEGRAM_BOT_TOKEN),
        }
    return {
        "linked": connection.is_linked,
        "username": connection.username,
        "first_name": connection.first_name,
        "linked_at": connection.linked_at,
        "last_interaction_at": connection.last_interaction_at,
        "bot_username": settings.TELEGRAM_BOT_USERNAME.lstrip("@"),
        "configured": bool(settings.TELEGRAM_BOT_TOKEN),
    }


@api_view(["GET"])
def connection(request):
    return Response(_connection_payload(TelegramConnection.objects.filter(user=request.user).first()))


@api_view(["POST"])
def link(request):
    data = services.start_linking(request.user)
    return Response(data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def unlink(request):
    services.unlink(request.user)
    return Response(_connection_payload(TelegramConnection.objects.filter(user=request.user).first()))


@api_view(["POST"])
def test_message(request):
    delivery = services.queue_message(
        request.user,
        text="👋 MyTasker is connected. You'll receive reminders and summaries here.",
        idempotency_key=f"test:{request.user.pk}:{int(__import__('time').time())}",
    )
    if delivery is None:
        raise Forbidden("Telegram is not linked.", code="telegram_not_linked")
    return Response({"queued": True, "delivery_id": delivery.pk})


@api_view(["GET"])
def deliveries(request):
    rows = (
        TelegramDelivery.objects.filter(user=request.user)
        .order_by("-created_at")
        .values("id", "kind", "status", "attempts", "last_error", "created_at", "delivered_at")[:30]
    )
    return Response(list(rows))


# ----------------------------------------------------------------- webhook


@api_view(["POST"])
@authentication_classes([])
@permission_classes([AllowAny])
@throttle_classes([])
def webhook(request):
    """
    Telegram → MyTasker. Authenticated by the `X-Telegram-Bot-Api-Secret-Token` header
    (constant-time compare) and de-duplicated by update_id. Processing happens in Celery so we
    always answer Telegram within its timeout.
    """
    secret = settings.TELEGRAM_WEBHOOK_SECRET
    provided = request.META.get("HTTP_X_TELEGRAM_BOT_API_SECRET_TOKEN", "")
    if not secret or not hmac.compare_digest(provided, secret):
        return Response(status=status.HTTP_403_FORBIDDEN)
    update = request.data if isinstance(request.data, dict) else {}
    update_id = update.get("update_id")
    if not isinstance(update_id, int):
        return Response({"ok": True})
    chat_id = None
    kind = ""
    if "message" in update:
        chat_id = (update["message"].get("chat") or {}).get("id")
        kind = "message"
    elif "callback_query" in update:
        chat_id = ((update["callback_query"].get("message") or {}).get("chat") or {}).get("id")
        kind = "callback"
    try:
        TelegramUpdateLog.objects.create(update_id=update_id, chat_id=chat_id, kind=kind)
    except IntegrityError:
        return Response({"ok": True, "duplicate": True})

    from apps.telegram.tasks import process_update

    process_update.delay(update)
    return Response({"ok": True})
