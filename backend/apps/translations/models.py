# MyTasker — background translations of user-authored content.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""
One row per translatable object. The row stores the detected source language and the translated
fields for every *other* supported language, plus a hash of the source text so a translation is
never redone while the original is unchanged and never served once the original has moved on.
"""

from __future__ import annotations

from django.db import models

from common.models import TimeStampedModel


class Translation(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        READY = "ready", "Ready"
        FAILED = "failed", "Failed"

    target_type = models.CharField(max_length=30)
    target_id = models.BigIntegerField()
    # sha256 of the canonical source payload this row was (or is being) translated from.
    source_hash = models.CharField(max_length=64)
    source_lang = models.CharField(max_length=8, blank=True)
    # {"en": {"title": "...", "description": "..."}, "ka": {...}} — never contains the source language.
    translations = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True)
    input_tokens = models.PositiveIntegerField(default=0)
    output_tokens = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "translations_translation"
        constraints = [
            models.UniqueConstraint(fields=["target_type", "target_id"], name="uniq_translation_target"),
        ]
        indexes = [models.Index(fields=["status", "updated_at"], name="translation_status_updated")]

    def __str__(self) -> str:
        return f"{self.target_type}:{self.target_id} [{self.status}]"

    @property
    def is_ready(self) -> bool:
        return self.status == self.Status.READY

    def for_lang(self, lang: str) -> dict[str, str]:
        """Translated fields for `lang`; empty when `lang` is the source language or not ready."""
        if not self.is_ready or lang == self.source_lang:
            return {}
        value = self.translations.get(lang) if isinstance(self.translations, dict) else None
        return value if isinstance(value, dict) else {}
