from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import SoftDeleteModel, TimeStampedModel


class Routine(TimeStampedModel, SoftDeleteModel):
    class Kind(models.TextChoices):
        PERSONAL = "personal", "Personal"
        BUSINESS = "business", "Business"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="routines")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    name = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "routines_routine"
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "kind"], condition=models.Q(deleted_at__isnull=True), name="uniq_routine_owner_kind"
            )
        ]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} routine"


class RoutineItem(TimeStampedModel, SoftDeleteModel):
    routine = models.ForeignKey(Routine, on_delete=models.CASCADE, related_name="items")
    name = models.CharField(max_length=120)
    description = models.CharField(max_length=300, blank=True)
    target_minutes = models.PositiveIntegerField(default=60)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    # Bitmask over weekdays, Monday = bit 0 .. Sunday = bit 6. 127 = every day.
    repeat_days = models.PositiveSmallIntegerField(default=127)
    order = models.IntegerField(default=0)
    counts_as_business = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "routines_item"
        ordering = ["order", "start_time", "id"]
        indexes = [models.Index(fields=["routine", "order"], name="routine_item_order")]

    def __str__(self) -> str:
        return self.name

    def occurs_on(self, weekday: int) -> bool:
        """weekday: Monday=0 .. Sunday=6"""
        return bool(self.repeat_days & (1 << weekday))


class RoutineCompletion(TimeStampedModel):
    item = models.ForeignKey(RoutineItem, on_delete=models.CASCADE, related_name="completions")
    date = models.DateField()
    completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    manual_minutes = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "routines_completion"
        constraints = [models.UniqueConstraint(fields=["item", "date"], name="uniq_routine_completion")]
        indexes = [models.Index(fields=["item", "-date"], name="routine_completion_lookup")]


class Rule(TimeStampedModel, SoftDeleteModel):
    """Persistent personal principles (not tasks)."""

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="rules")
    text = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    order = models.IntegerField(default=0)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "routines_rule"
        ordering = ["order", "id"]
        indexes = [models.Index(fields=["owner", "order"], name="rule_owner_order")]

    def __str__(self) -> str:
        return self.text


class RuleCompletion(models.Model):
    """Daily self-check for a rule: did I keep it today? One row per rule per local day."""

    rule = models.ForeignKey(Rule, on_delete=models.CASCADE, related_name="completions")
    date = models.DateField()
    kept = models.BooleanField(default=True)
    marked_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "routines_rule_completion"
        constraints = [models.UniqueConstraint(fields=["rule", "date"], name="uniq_rule_completion")]
        indexes = [models.Index(fields=["rule", "-date"], name="rule_completion_lookup")]

    def __str__(self) -> str:
        return f"RuleCompletion({self.rule_id}, {self.date}, {self.kept})"
