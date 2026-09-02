from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class TelegramConnection(TimeStampedModel):
    """Secure account linking: /start <one-time token>. Usernames are never trusted for identity."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="telegram_connection"
    )
    chat_id = models.BigIntegerField(unique=True, null=True, blank=True)
    telegram_user_id = models.BigIntegerField(null=True, blank=True)
    username = models.CharField(max_length=64, blank=True)
    first_name = models.CharField(max_length=120, blank=True)

    link_token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    link_expires_at = models.DateTimeField(null=True, blank=True)
    linked_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    last_interaction_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "telegram_connection"

    def __str__(self) -> str:
        return f"TelegramConnection({self.user_id})"

    @property
    def is_linked(self) -> bool:
        return self.chat_id is not None and self.linked_at is not None and self.is_active


class TelegramDelivery(TimeStampedModel):
    """
    One row per outgoing Telegram message. `idempotency_key` makes Celery retries safe: the task
    re-reads the row under `select_for_update` and skips anything already delivered.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENDING = "sending", "Sending"
        DELIVERED = "delivered", "Delivered"
        FAILED = "failed", "Failed"
        RETRYING = "retrying", "Retrying"
        SKIPPED = "skipped", "Skipped"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="telegram_deliveries")
    chat_id = models.BigIntegerField()
    idempotency_key = models.CharField(max_length=160, unique=True)
    text = models.TextField()
    parse_mode = models.CharField(max_length=12, default="HTML")
    reply_markup = models.JSONField(null=True, blank=True)
    notification = models.ForeignKey(
        "notifications.Notification", on_delete=models.SET_NULL, null=True, blank=True, related_name="deliveries"
    )
    activity_event = models.ForeignKey(
        "collab.ActivityEvent", on_delete=models.SET_NULL, null=True, blank=True, related_name="telegram_deliveries"
    )

    status = models.CharField(max_length=10, choices=Status.choices, default=Status.QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    telegram_message_id = models.BigIntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "telegram_delivery"
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["user", "-id"], name="tg_delivery_user"),
            models.Index(fields=["status", "-id"], name="tg_delivery_status"),
        ]

    def __str__(self) -> str:
        return f"TelegramDelivery({self.pk}, {self.status})"


class TelegramUpdateLog(models.Model):
    """De-duplicates webhook updates (Telegram may redeliver the same update_id)."""

    update_id = models.BigIntegerField(unique=True)
    chat_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    handled = models.BooleanField(default=False)
    kind = models.CharField(max_length=30, blank=True)

    class Meta:
        db_table = "telegram_update_log"
        indexes = [models.Index(fields=["-created_at"], name="tg_update_created")]

    def __str__(self) -> str:
        return f"update:{self.update_id}"
