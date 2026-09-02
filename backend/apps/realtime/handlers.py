"""Post-commit event handler: push a compact realtime payload to the right WebSocket groups."""

from __future__ import annotations

from apps.realtime import publisher
from common.models import Visibility

# Events that only matter to the acting user (timer sync etc.) never fan out to projects.
PERSONAL_ONLY_PREFIXES = ("timer.", "sleep.", "share.", "reminder.", "ai.", "idea.")


def publish_activity(event_id: int) -> None:
    from apps.collab.models import ActivityEvent

    event = (
        ActivityEvent.objects.filter(pk=event_id)
        .only(
            "id",
            "name",
            "owner_user_id",
            "project_id",
            "visibility",
            "target_type",
            "target_id",
            "payload",
            "actor_display",
        )
        .first()
    )
    if event is None:
        return
    payload = {
        "type": "event",
        "id": event.pk,
        "name": event.name,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "project_id": event.project_id,
        "actor": event.actor_display,
        "payload": event.payload,
    }
    publisher.publish_to_user(event.owner_user_id, payload)
    if (
        event.project_id
        and event.visibility == Visibility.GROUP
        and not event.name.startswith(PERSONAL_ONLY_PREFIXES)
    ):
        publisher.publish_to_project(event.project_id, payload)
