from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import Source, TimeStampedModel


class AIAction(TimeStampedModel):
    """
    Record of an AI interaction and the tool calls it produced. Destructive or bulk operations are
    stored as `proposed` and require explicit user confirmation before execution.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PROPOSED = "proposed", "Awaiting confirmation"
        EXECUTED = "executed", "Executed"
        REJECTED = "rejected", "Rejected"
        FAILED = "failed", "Failed"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ai_actions")
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.AI_WEB)
    input_text = models.TextField()
    model = models.CharField(max_length=80, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    requires_confirmation = models.BooleanField(default=False)
    tool_calls = models.JSONField(default=list, blank=True)
    result = models.JSONField(default=dict, blank=True)
    reply_text = models.TextField(blank=True)
    error = models.CharField(max_length=300, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)
    duration_ms = models.PositiveIntegerField(default=0)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "ai_action"
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["user", "-id"], name="ai_action_user"),
            models.Index(fields=["status", "-id"], name="ai_action_status"),
        ]

    def __str__(self) -> str:
        return f"AIAction({self.pk}, {self.status})"
