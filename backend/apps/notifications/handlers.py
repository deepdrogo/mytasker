"""Post-commit hook: hand the event to Celery so notification fan-out never blocks a request."""

from __future__ import annotations

import logging

logger = logging.getLogger("mytasker.notifications")


def schedule_fan_out(event_id: int) -> None:
    from apps.notifications.tasks import fan_out_event

    try:
        fan_out_event.delay(event_id)
    except Exception:  # pragma: no cover - broker down must not break the request
        logger.exception("could not enqueue notification fan-out", extra={"event_id": event_id})
