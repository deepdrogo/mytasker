from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from common.models import Source, TimeStampedModel


class TimeEntryQuerySet(models.QuerySet):
    def running(self):
        return self.filter(ended_at__isnull=True)

    def finished(self):
        return self.filter(ended_at__isnull=False)

    def in_window(self, start, end):
        """Entries overlapping [start, end)."""
        return self.filter(started_at__lt=end).filter(Q(ended_at__gt=start) | Q(ended_at__isnull=True))


class TimeEntry(TimeStampedModel):
    """
    Authoritative time tracking. The browser never owns timer state: `started_at` lives here and the
    UI only renders `now - started_at`. A single partial unique index guarantees one running entry
    per user, which also prevents double counting.

    Pause/resume is modelled as stop + a new entry linked via `resumed_from`.
    """

    class Category(models.TextChoices):
        PERSONAL = "personal", "Personal"
        BUSINESS = "business", "Business"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="time_entries")
    category = models.CharField(max_length=10, choices=Category.choices, default=Category.BUSINESS)
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="time_entries"
    )
    task = models.ForeignKey(
        "tasks.Task", on_delete=models.SET_NULL, null=True, blank=True, related_name="time_entries"
    )
    routine_item = models.ForeignKey(
        "routines.RoutineItem", on_delete=models.SET_NULL, null=True, blank=True, related_name="time_entries"
    )
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)  # denormalised on stop
    note = models.CharField(max_length=300, blank=True)
    is_manual = models.BooleanField(default=False)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)
    resumed_from = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="resumed_entries"
    )

    objects = TimeEntryQuerySet.as_manager()

    class Meta:
        db_table = "time_tracking_entry"
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner"], condition=Q(ended_at__isnull=True), name="uniq_running_timer_per_user"
            ),
            models.CheckConstraint(
                condition=Q(ended_at__isnull=True) | Q(ended_at__gt=models.F("started_at")),
                name="time_entry_end_after_start",
            ),
        ]
        indexes = [
            models.Index(fields=["owner", "-started_at"], name="time_owner_started"),
            models.Index(fields=["owner", "category", "-started_at"], name="time_owner_cat_started"),
            models.Index(fields=["project", "-started_at"], name="time_project_started"),
            models.Index(fields=["task"], name="time_task"),
        ]

    def __str__(self) -> str:
        return f"TimeEntry({self.owner_id}, {self.started_at:%Y-%m-%d %H:%M})"

    @property
    def is_running(self) -> bool:
        return self.ended_at is None

    def current_seconds(self) -> int:
        end = self.ended_at or timezone.now()
        return max(0, int((end - self.started_at).total_seconds()))


class SleepSession(TimeStampedModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sleep_sessions")
    started_at = models.DateTimeField()
    ended_at = models.DateTimeField(null=True, blank=True)
    duration_seconds = models.PositiveIntegerField(default=0)
    is_manual = models.BooleanField(default=False)
    note = models.CharField(max_length=200, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)

    class Meta:
        db_table = "time_tracking_sleep"
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["owner"], condition=Q(ended_at__isnull=True), name="uniq_running_sleep_per_user"
            )
        ]
        indexes = [models.Index(fields=["owner", "-started_at"], name="sleep_owner_started")]

    @property
    def is_running(self) -> bool:
        return self.ended_at is None

    def current_seconds(self) -> int:
        end = self.ended_at or timezone.now()
        return max(0, int((end - self.started_at).total_seconds()))
