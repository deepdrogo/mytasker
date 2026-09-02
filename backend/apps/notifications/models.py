from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class NotificationPreference(TimeStampedModel):
    class Mode(models.TextChoices):
        IMPORTANT = "important", "Important only"
        ALL = "all", "All"
        CUSTOM = "custom", "Custom"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preferences"
    )
    mode = models.CharField(max_length=10, choices=Mode.choices, default=Mode.IMPORTANT)

    telegram_enabled = models.BooleanField(default=True)
    in_app_enabled = models.BooleanField(default=True)

    # Per-event toggles (used when mode = custom; "important" uses the IMPORTANT_EVENTS set)
    on_task_created = models.BooleanField(default=False)
    on_task_completed = models.BooleanField(default=True)
    on_task_reopened = models.BooleanField(default=True)
    on_subtask_created = models.BooleanField(default=False)
    on_subtask_completed = models.BooleanField(default=True)
    on_comment_created = models.BooleanField(default=True)
    on_deadline_changed = models.BooleanField(default=True)
    on_assignment_changed = models.BooleanField(default=True)
    on_member_joined = models.BooleanField(default=True)
    on_member_removed = models.BooleanField(default=True)
    on_share_task_completed = models.BooleanField(default=True)
    on_share_opened = models.BooleanField(default=False)
    on_reminder = models.BooleanField(default=True)

    quiet_hours_start = models.TimeField(null=True, blank=True)
    quiet_hours_end = models.TimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications_preference"

    def __str__(self) -> str:
        return f"NotificationPreference({self.user_id})"


class Notification(TimeStampedModel):
    class Channel(models.TextChoices):
        IN_APP = "in_app", "In-app"
        TELEGRAM = "telegram", "Telegram"

    class Category(models.TextChoices):
        REMINDER = "reminder", "Reminder"
        DEADLINE = "deadline", "Deadline"
        TEAM = "team", "Team activity"
        COMMENT = "comment", "Comment"
        GUEST = "guest", "Guest activity"
        ASSIGNMENT = "assignment", "Assignment"
        AI = "ai", "AI"
        SUMMARY = "summary", "Summary"
        SYSTEM = "system", "System"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    category = models.CharField(max_length=12, choices=Category.choices, default=Category.SYSTEM)
    event_name = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    url = models.CharField(max_length=300, blank=True)
    activity_event = models.ForeignKey(
        "collab.ActivityEvent", on_delete=models.SET_NULL, null=True, blank=True, related_name="notifications"
    )
    payload = models.JSONField(default=dict, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    dedupe_key = models.CharField(max_length=120, blank=True)

    class Meta:
        db_table = "notifications_notification"
        ordering = ["-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "dedupe_key"], condition=~models.Q(dedupe_key=""), name="uniq_notification_dedupe"
            )
        ]
        indexes = [
            models.Index(fields=["user", "-id"], name="notification_user"),
            models.Index(fields=["user", "read_at"], name="notification_unread"),
        ]

    def __str__(self) -> str:
        return self.title
