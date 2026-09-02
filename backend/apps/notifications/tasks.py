from __future__ import annotations

from celery import shared_task


@shared_task(
    name="apps.notifications.tasks.fan_out_event",
    autoretry_for=(Exception,),
    retry_backoff=2,
    retry_kwargs={"max_retries": 3},
)
def fan_out_event(event_id: int) -> int:
    from apps.notifications.services import fan_out

    return fan_out(event_id)
