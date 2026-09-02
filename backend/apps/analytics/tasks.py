"""Celery: nightly DailySummary rollups. Idempotent - re-running simply upserts."""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.analytics import services
from common.tz import today_for

logger = logging.getLogger("mytasker.analytics")


@shared_task(name="apps.analytics.tasks.rollup_daily_summaries")
def rollup_daily_summaries() -> int:
    """
    Runs hourly. For each recently active user, materialise yesterday (in the user's timezone).
    Users whose local midnight just passed get a fresh row; re-running is harmless.
    """
    user_model = get_user_model()
    cutoff = timezone.now() - timedelta(days=45)
    users = user_model.objects.filter(is_active=True).filter(last_seen_at__gte=cutoff).select_related("preferences")
    count = 0
    for user in users.iterator():
        try:
            yesterday = today_for(user) - timedelta(days=1)
            services.upsert_summary(user, yesterday)
            count += 1
        except Exception:  # noqa: BLE001 - one bad user must not stop the batch
            logger.exception("daily rollup failed for user %s", user.pk)
    return count


@shared_task(name="apps.analytics.tasks.rollup_user_day")
def rollup_user_day(user_id: int, day_iso: str) -> None:
    from datetime import date

    user_model = get_user_model()
    user = user_model.objects.filter(pk=user_id).select_related("preferences").first()
    if user:
        services.upsert_summary(user, date.fromisoformat(day_iso))
