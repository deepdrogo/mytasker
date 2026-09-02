"""Post-commit domain event hook: queue a translation whenever user-authored text is created or edited."""

from __future__ import annotations

import logging

from common.events import EventName

logger = logging.getLogger("mytasker.translations")

# event name -> target type stored in the ActivityEvent (or "comment" resolved from the payload)
TRIGGERS = {
    EventName.TASK_CREATED: "task",
    EventName.TASK_UPDATED: "task",
    EventName.SUBTASK_CREATED: "task",
    EventName.PROJECT_CREATED: "project",
    EventName.PROJECT_UPDATED: "project",
    EventName.PROMPT_CREATED: "prompt",
    EventName.PROMPT_UPDATED: "prompt",
    EventName.IDEA_CREATED: "idea",
    EventName.COMMENT_CREATED: "comment",
    EventName.COMMENT_UPDATED: "comment",
}


def schedule_translation(event_id: int) -> None:
    from apps.collab.models import ActivityEvent
    from apps.translations.services import enabled, request_translation

    if not enabled():
        return
    event = ActivityEvent.objects.filter(pk=event_id).only("name", "target_type", "target_id", "payload").first()
    if event is None:
        return
    target_type = TRIGGERS.get(event.name)
    if target_type is None:
        return
    target_id = event.target_id
    if target_type == "comment":
        target_id = (event.payload or {}).get("comment_id")
        if not target_id:
            return
    try:
        request_translation(target_type, int(target_id))
    except Exception:  # pragma: no cover - never let a translation problem surface to the request
        logger.exception("could not schedule translation", extra={"event_id": event_id})
