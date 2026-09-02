"""Fan-out helper for WebSocket messages. Called only from the event dispatcher / services."""

from __future__ import annotations

import logging
from typing import Any

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.realtime.consumers import project_group, user_group

logger = logging.getLogger("mytasker.ws")


def _send(group: str, payload: dict[str, Any]) -> None:
    layer = get_channel_layer()
    if layer is None:  # pragma: no cover
        return
    try:
        async_to_sync(layer.group_send)(group, {"type": "broadcast", "payload": payload})
    except Exception:  # pragma: no cover - realtime must never break a request
        logger.warning("ws publish failed", extra={"group": group, "event": payload.get("type")})


def publish_to_user(user_id: int, payload: dict[str, Any]) -> None:
    _send(user_group(user_id), payload)


def publish_to_users(user_ids, payload: dict[str, Any]) -> None:
    for uid in set(user_ids):
        publish_to_user(uid, payload)


def publish_to_project(project_id: int, payload: dict[str, Any]) -> None:
    """Only for group-visible data. Private Group Plus payloads must use publish_to_user."""
    _send(project_group(project_id), payload)
