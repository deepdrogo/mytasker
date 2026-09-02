"""
Domain event architecture.

Flow:  service mutation (inside transaction.atomic)
       -> emit(DomainEvent)
       -> ActivityEvent + AuditLog persisted in the same transaction
       -> transaction.on_commit -> registered handlers (realtime publish, Celery notification fan-out)

Handlers are registered at app-ready time via `subscribe()`. Nothing in this module talks to
Telegram, Redis or Anthropic directly.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from django.apps import apps
from django.db import transaction

from common.actors import Actor
from common.models import Visibility

logger = logging.getLogger("mytasker.events")


class EventName:
    TASK_CREATED = "task.created"
    TASK_UPDATED = "task.updated"
    TASK_COMPLETED = "task.completed"
    TASK_REOPENED = "task.reopened"
    TASK_DELETED = "task.deleted"
    TASK_DEADLINE_CHANGED = "task.deadline_changed"
    TASK_ASSIGNED = "task.assigned"
    SUBTASK_CREATED = "subtask.created"
    SUBTASK_COMPLETED = "subtask.completed"
    SUBTASK_REOPENED = "subtask.reopened"
    COMMENT_CREATED = "comment.created"
    COMMENT_UPDATED = "comment.updated"
    COMMENT_DELETED = "comment.deleted"
    PROJECT_CREATED = "project.created"
    PROJECT_UPDATED = "project.updated"
    PROJECT_MODE_CHANGED = "project.mode_changed"
    PROJECT_MEMBER_INVITED = "project.member_invited"
    PROJECT_MEMBER_JOINED = "project.member_joined"
    PROJECT_MEMBER_REMOVED = "project.member_removed"
    PROJECT_MEMBER_ROLE_CHANGED = "project.member_role_changed"
    PROMPT_CREATED = "prompt.created"
    PROMPT_UPDATED = "prompt.updated"
    PROMPT_DELETED = "prompt.deleted"
    PROMPT_VISIBILITY_CHANGED = "prompt.visibility_changed"
    IDEA_CREATED = "idea.created"
    IDEA_CONVERTED = "idea.converted"
    SHARE_CREATED = "share.created"
    SHARE_OPENED = "share.opened"
    SHARE_GUEST_IDENTIFIED = "share.guest_identified"
    SHARE_TASK_COMPLETED = "share.task_completed"
    SHARE_TASK_REOPENED = "share.task_reopened"
    SHARE_EXPIRED = "share.expired"
    TIMER_STARTED = "timer.started"
    TIMER_STOPPED = "timer.stopped"
    SLEEP_STARTED = "sleep.started"
    SLEEP_ENDED = "sleep.ended"
    REMINDER_DUE = "reminder.due"
    AI_ACTION_EXECUTED = "ai.action_executed"


# Events that are meaningful for the project activity feed.
FEED_EVENTS = {
    EventName.TASK_CREATED,
    EventName.TASK_COMPLETED,
    EventName.TASK_REOPENED,
    EventName.TASK_DELETED,
    EventName.TASK_DEADLINE_CHANGED,
    EventName.TASK_ASSIGNED,
    EventName.SUBTASK_CREATED,
    EventName.SUBTASK_COMPLETED,
    EventName.SUBTASK_REOPENED,
    EventName.COMMENT_CREATED,
    EventName.PROJECT_CREATED,
    EventName.PROJECT_MODE_CHANGED,
    EventName.PROJECT_MEMBER_JOINED,
    EventName.PROJECT_MEMBER_REMOVED,
    EventName.PROJECT_MEMBER_ROLE_CHANGED,
    EventName.PROMPT_CREATED,
    EventName.PROMPT_UPDATED,
    EventName.PROMPT_VISIBILITY_CHANGED,
    EventName.IDEA_CONVERTED,
    EventName.SHARE_GUEST_IDENTIFIED,
    EventName.SHARE_TASK_COMPLETED,
    EventName.SHARE_TASK_REOPENED,
}


@dataclass
class DomainEvent:
    name: str
    actor: Actor
    target_type: str
    target_id: int
    owner_user_id: int
    project_id: int | None = None
    visibility: str = Visibility.GROUP
    payload: dict[str, Any] = field(default_factory=dict)
    audit_action: str | None = None
    audit_metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def in_feed(self) -> bool:
        return self.name in FEED_EVENTS


Handler = Callable[[int], None]
_handlers: list[Handler] = []


def subscribe(handler: Handler) -> None:
    if handler not in _handlers:
        _handlers.append(handler)


def emit(event: DomainEvent) -> int:
    """
    Persist the event as ActivityEvent (+ AuditLog) inside the current transaction and schedule
    post-commit handlers. Returns the ActivityEvent id.
    """
    ActivityEvent = apps.get_model("collab", "ActivityEvent")
    AuditLog = apps.get_model("audit", "AuditLog")

    record = ActivityEvent.objects.create(
        name=event.name,
        project_id=event.project_id,
        owner_user_id=event.owner_user_id,
        target_type=event.target_type,
        target_id=event.target_id,
        visibility=event.visibility,
        in_feed=event.in_feed,
        payload=_safe_payload(event.payload),
        **event.actor.as_activity_fields(),
    )
    AuditLog.objects.create(
        action=event.audit_action or event.name,
        target_type=event.target_type,
        target_id=event.target_id,
        project_id=event.project_id,
        owner_user_id=event.owner_user_id,
        metadata=_safe_payload(event.audit_metadata or event.payload),
        activity_event=record,
        **event.actor.as_activity_fields(),
    )

    event_id = record.pk

    def _after_commit() -> None:
        for handler in list(_handlers):
            try:
                handler(event_id)
            except Exception:  # pragma: no cover - handlers must never break the request
                logger.exception("domain event handler failed", extra={"event_id": event_id, "event": event.name})

    transaction.on_commit(_after_commit)
    return event_id


_FORBIDDEN_KEYS = {"password", "token", "secret", "api_key", "authorization", "body"}


def _safe_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Strip anything that looks like a secret and coerce values to JSON-safe primitives."""
    safe: dict[str, Any] = {}
    for key, value in (payload or {}).items():
        if key.lower() in _FORBIDDEN_KEYS:
            continue
        if isinstance(value, (str, int, float, bool)) or value is None:
            safe[key] = value
        elif isinstance(value, (list, tuple)):
            safe[key] = [v if isinstance(v, (str, int, float, bool)) or v is None else str(v) for v in value]
        elif isinstance(value, dict):
            safe[key] = _safe_payload(value)
        else:
            safe[key] = str(value)
    return safe
