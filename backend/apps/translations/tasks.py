from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger("mytasker.translations")


@shared_task(
    bind=True,
    name="apps.translations.tasks.translate_object",
    rate_limit="60/m",
    soft_time_limit=120,
    time_limit=150,
    max_retries=3,
)
def translate_object(self, target_type: str, target_id: int) -> str:
    from apps.translations.services import RetryLater, run_translation

    try:
        row = run_translation(target_type, target_id)
    except RetryLater as exc:
        # 20s, 40s, 80s - enough to ride out a rate-limit burst without hammering the provider.
        raise self.retry(exc=exc, countdown=20 * (2**self.request.retries))
    return row.status if row is not None else "skipped"


@shared_task(name="apps.translations.tasks.backfill_user")
def backfill_user(user_id: int, limit: int = 500) -> int:
    from apps.translations.services import backfill_for_user

    return backfill_for_user(user_id, limit=limit)
