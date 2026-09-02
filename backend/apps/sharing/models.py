from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class ShareLink(TimeStampedModel):
    """
    Anonymous share link: mytasker.io/s/<token>

    Only the SHA-256 hash of the token is stored, so a database leak cannot reveal working links.
    Passwords use Django's password hasher.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="share_links")
    title = models.CharField(max_length=200, blank=True)
    token_hash = models.CharField(max_length=64, unique=True)
    token_prefix = models.CharField(max_length=8, blank=True)  # display only, not enough to guess

    password_hash = models.CharField(max_length=255, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    ask_guest_name = models.BooleanField(default=True)
    allow_complete = models.BooleanField(default=True)
    allow_reopen = models.BooleanField(default=False)
    one_time = models.BooleanField(default=False)
    max_uses = models.PositiveIntegerField(null=True, blank=True)
    use_count = models.PositiveIntegerField(default=0)
    revoked_at = models.DateTimeField(null=True, blank=True)
    last_opened_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sharing_share_link"
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["owner", "-created_at"], name="share_owner_created")]

    def __str__(self) -> str:
        return self.title or f"Share#{self.pk}"

    @property
    def requires_password(self) -> bool:
        return bool(self.password_hash)

    @property
    def is_expired(self) -> bool:
        return bool(self.expires_at and self.expires_at <= timezone.now())

    @property
    def is_exhausted(self) -> bool:
        if self.one_time and self.use_count >= 1:
            return True
        return bool(self.max_uses and self.use_count >= self.max_uses)

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and not self.is_expired and not self.is_exhausted


class ShareLinkItem(models.Model):
    share = models.ForeignKey(ShareLink, on_delete=models.CASCADE, related_name="items")
    task = models.ForeignKey("tasks.Task", on_delete=models.CASCADE, related_name="share_items")
    order = models.IntegerField(default=0)

    class Meta:
        db_table = "sharing_share_item"
        ordering = ["order", "id"]
        constraints = [models.UniqueConstraint(fields=["share", "task"], name="uniq_share_task")]

    def __str__(self) -> str:
        return f"share:{self.share_id} task:{self.task_id}"


class ShareGuestSession(TimeStampedModel):
    share = models.ForeignKey(ShareLink, on_delete=models.CASCADE, related_name="guest_sessions")
    guest_name = models.CharField(max_length=80, blank=True)
    session_token_hash = models.CharField(max_length=64, unique=True)
    ip_hash = models.CharField(max_length=64, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "sharing_guest_session"
        indexes = [models.Index(fields=["share", "-last_seen_at"], name="guest_share_seen")]

    def __str__(self) -> str:
        return self.guest_name or "Guest"

    @property
    def display_name(self) -> str:
        return self.guest_name.strip() or "Guest"
