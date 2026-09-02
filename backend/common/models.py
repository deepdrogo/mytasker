from __future__ import annotations

from django.db import models
from django.utils import timezone


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SoftDeleteQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(deleted_at__isnull=True)

    def dead(self):
        return self.filter(deleted_at__isnull=False)

    def soft_delete(self):
        return self.update(deleted_at=timezone.now())


class SoftDeleteManager(models.Manager):
    """Default manager excludes soft-deleted rows. Use `all_objects` for everything."""

    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).alive()


class SoftDeleteModel(models.Model):
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # `objects` must stay first: Django's default manager (used by reverse relations) is the first one declared.
    objects = SoftDeleteManager()
    all_objects = models.Manager()  # noqa: DJ012 - ruff mis-classifies the custom manager above as a field

    class Meta:
        abstract = True

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    def soft_delete(self) -> None:
        self.deleted_at = timezone.now()
        self.save(update_fields=["deleted_at"])

    def restore(self) -> None:
        self.deleted_at = None
        self.save(update_fields=["deleted_at"])


class Priority(models.TextChoices):
    CRITICAL = "critical", "Critical"
    HIGH = "high", "High"
    NORMAL = "normal", "Normal"
    LOW = "low", "Low"


PRIORITY_RANK = {
    Priority.CRITICAL: 0,
    Priority.HIGH: 1,
    Priority.NORMAL: 2,
    Priority.LOW: 3,
}


class Visibility(models.TextChoices):
    """Object visibility inside a project. Only meaningful for Group / Group Plus projects."""

    PRIVATE = "private", "Private"
    GROUP = "group", "Group visible"


class Source(models.TextChoices):
    WEB = "web", "Web"
    MOBILE_WEB = "mobile_web", "Mobile web"
    TELEGRAM = "telegram", "Telegram"
    TEAM = "team", "Team"
    SHARE_LINK = "share_link", "Share link"
    AI_WEB = "ai_web", "AI (web)"
    AI_TELEGRAM = "ai_telegram", "AI (Telegram)"
    SYSTEM = "system", "System"
