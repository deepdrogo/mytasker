from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class DailySummary(TimeStampedModel):
    """
    Pre-aggregated per-user, per-local-day metrics produced by Celery. Weekly/monthly reviews
    aggregate these rows instead of scanning years of raw data.
    """

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="daily_summaries")
    date = models.DateField()

    tasks_planned = models.PositiveIntegerField(default=0)
    tasks_completed = models.PositiveIntegerField(default=0)
    tasks_missed = models.PositiveIntegerField(default=0)
    personal_completed = models.PositiveIntegerField(default=0)
    business_completed = models.PositiveIntegerField(default=0)
    team_completed = models.PositiveIntegerField(default=0)
    guest_completed = models.PositiveIntegerField(default=0)

    business_minutes = models.PositiveIntegerField(default=0)
    personal_minutes = models.PositiveIntegerField(default=0)
    business_target_minutes = models.PositiveIntegerField(default=0)
    sleep_minutes = models.PositiveIntegerField(default=0)
    sleep_target_minutes = models.PositiveIntegerField(default=0)

    routine_items_total = models.PositiveIntegerField(default=0)
    routine_items_completed = models.PositiveIntegerField(default=0)

    project_minutes = models.JSONField(default=dict, blank=True)  # {project_id: minutes}
    metrics = models.JSONField(default=dict, blank=True)  # room for future metrics

    class Meta:
        db_table = "analytics_daily_summary"
        ordering = ["-date"]
        constraints = [models.UniqueConstraint(fields=["user", "date"], name="uniq_daily_summary")]
        indexes = [models.Index(fields=["user", "-date"], name="daily_summary_lookup")]

    def __str__(self) -> str:
        return f"DailySummary({self.user_id}, {self.date})"

    @property
    def completion_rate(self) -> float:
        return round(self.tasks_completed / self.tasks_planned * 100, 1) if self.tasks_planned else 0.0

    @property
    def routine_rate(self) -> float:
        if not self.routine_items_total:
            return 0.0
        return round(self.routine_items_completed / self.routine_items_total * 100, 1)
