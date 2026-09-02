from __future__ import annotations

from django.conf import settings
from django.db import models

from common.actors import ActorKind
from common.models import Source

ACTOR_KIND_CHOICES = [
    (ActorKind.USER, "User"),
    (ActorKind.GUEST, "Guest"),
    (ActorKind.AI, "AI"),
    (ActorKind.TELEGRAM, "Telegram"),
    (ActorKind.SYSTEM, "System"),
]


class AuditLog(models.Model):
    """Append-only audit trail. Metadata is sanitised - never contains secrets or prompt bodies."""

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    action = models.CharField(max_length=60, db_index=True)

    actor_kind = models.CharField(max_length=10, choices=ACTOR_KIND_CHOICES, default=ActorKind.USER)
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    actor_guest = models.ForeignKey(
        "sharing.ShareGuestSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    actor_display = models.CharField(max_length=120, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)

    owner_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_audit_logs"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    target_type = models.CharField(max_length=30)
    target_id = models.BigIntegerField()
    metadata = models.JSONField(default=dict, blank=True)
    activity_event = models.ForeignKey(
        "collab.ActivityEvent", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )

    class Meta:
        db_table = "audit_log"
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["owner_user", "-id"], name="audit_owner"),
            models.Index(fields=["target_type", "target_id"], name="audit_target"),
            models.Index(fields=["action", "-id"], name="audit_action"),
        ]

    def __str__(self) -> str:
        return f"{self.action}#{self.pk}"
