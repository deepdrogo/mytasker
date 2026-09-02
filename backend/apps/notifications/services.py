"""
NotificationService: turn a persisted ActivityEvent into per-user notifications.

Recipient resolution + preference filtering happen here; delivery is split into in-app
(Notification row + WebSocket push) and Telegram (TelegramDelivery row + Celery send).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import time

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.collab.models import ActivityEvent
from apps.notifications.models import Notification, NotificationPreference
from common.actors import ActorKind
from common.events import EventName
from common.models import Visibility
from common.tz import now_for

logger = logging.getLogger("mytasker.notifications")

# Events that are always delivered when mode == "important".
IMPORTANT_EVENTS = {
    EventName.TASK_COMPLETED,
    EventName.TASK_ASSIGNED,
    EventName.TASK_DEADLINE_CHANGED,
    EventName.COMMENT_CREATED,
    EventName.PROJECT_MEMBER_JOINED,
    EventName.PROJECT_MEMBER_REMOVED,
    EventName.SHARE_TASK_COMPLETED,
    EventName.SHARE_TASK_REOPENED,
    EventName.REMINDER_DUE,
}

# Event -> NotificationPreference custom toggle.
PREF_FIELD = {
    EventName.TASK_CREATED: "on_task_created",
    EventName.TASK_COMPLETED: "on_task_completed",
    EventName.TASK_REOPENED: "on_task_reopened",
    EventName.SUBTASK_CREATED: "on_subtask_created",
    EventName.SUBTASK_COMPLETED: "on_subtask_completed",
    EventName.COMMENT_CREATED: "on_comment_created",
    EventName.TASK_DEADLINE_CHANGED: "on_deadline_changed",
    EventName.TASK_ASSIGNED: "on_assignment_changed",
    EventName.PROJECT_MEMBER_JOINED: "on_member_joined",
    EventName.PROJECT_MEMBER_REMOVED: "on_member_removed",
    EventName.SHARE_TASK_COMPLETED: "on_share_task_completed",
    EventName.SHARE_TASK_REOPENED: "on_share_task_completed",
    EventName.SHARE_OPENED: "on_share_opened",
    EventName.SHARE_GUEST_IDENTIFIED: "on_share_opened",
    EventName.REMINDER_DUE: "on_reminder",
}

CATEGORY = {
    EventName.COMMENT_CREATED: Notification.Category.COMMENT,
    EventName.TASK_ASSIGNED: Notification.Category.ASSIGNMENT,
    EventName.TASK_DEADLINE_CHANGED: Notification.Category.DEADLINE,
    EventName.REMINDER_DUE: Notification.Category.REMINDER,
    EventName.SHARE_TASK_COMPLETED: Notification.Category.GUEST,
    EventName.SHARE_TASK_REOPENED: Notification.Category.GUEST,
    EventName.SHARE_OPENED: Notification.Category.GUEST,
    EventName.SHARE_GUEST_IDENTIFIED: Notification.Category.GUEST,
    EventName.AI_ACTION_EXECUTED: Notification.Category.AI,
}


@dataclass
class Rendered:
    title: str
    body: str
    url: str


def preferences_for(user) -> NotificationPreference:
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    return prefs


def wants(prefs: NotificationPreference, event_name: str) -> bool:
    if prefs.mode == NotificationPreference.Mode.ALL:
        return True
    if prefs.mode == NotificationPreference.Mode.IMPORTANT:
        return event_name in IMPORTANT_EVENTS
    field = PREF_FIELD.get(event_name)
    return bool(field and getattr(prefs, field, False))


def in_quiet_hours(prefs: NotificationPreference, user) -> bool:
    start, end = prefs.quiet_hours_start, prefs.quiet_hours_end
    if not start or not end:
        return False
    current: time = now_for(user).time()
    if start <= end:
        return start <= current < end
    return current >= start or current < end  # overnight window


# ----------------------------------------------------------------- recipients


def recipients_for(event: ActivityEvent) -> set[int]:
    """User ids who should hear about this event. The actor is excluded later."""
    name = event.name
    users: set[int] = set()
    payload = event.payload or {}

    if event.target_type == "task":
        from apps.tasks.models import Task

        task = Task.all_objects.filter(pk=event.target_id).select_related("project").first()
        if task is not None:
            users.add(task.owner_id)
            if task.assignee_id:
                users.add(task.assignee_id)
            if task.project_id and task.project and task.project.owner_id:
                users.add(task.project.owner_id)
            # Guest completion is interesting to the whole group (visibility permitting).
            group_interesting = name in (
                EventName.SHARE_TASK_COMPLETED,
                EventName.SHARE_TASK_REOPENED,
                EventName.TASK_COMPLETED,
            )
            if group_interesting and task.project_id and task.visibility == Visibility.GROUP:
                users.update(_member_ids(task.project_id))
    elif event.target_type == "project" and event.project_id:
        from apps.projects.models import Project

        project = Project.all_objects.filter(pk=event.project_id).first()
        if project is not None:
            users.add(project.owner_id)
            if name in (
                EventName.PROJECT_MEMBER_JOINED,
                EventName.PROJECT_MEMBER_REMOVED,
                EventName.PROJECT_MODE_CHANGED,
                EventName.COMMENT_CREATED,
            ):
                users.update(_member_ids(project.pk))
    elif event.target_type == "share" or event.target_type == "reminder":
        users.add(event.owner_user_id)
    else:
        users.add(event.owner_user_id)

    # Private (Group Plus) events stay with the owner regardless of who else was found.
    if event.visibility == Visibility.PRIVATE and event.project_id:
        users = {event.owner_user_id} | ({payload.get("assignee_id")} if payload.get("assignee_id") else set())
    if event.actor_kind == ActorKind.USER and event.actor_user_id:
        users.discard(event.actor_user_id)
    return {u for u in users if u}


def _member_ids(project_id: int) -> set[int]:
    from apps.projects.models import ProjectMembership

    return set(
        ProjectMembership.objects.filter(
            project_id=project_id, accepted_at__isnull=False, user__isnull=False
        ).values_list("user_id", flat=True)
    )


# ----------------------------------------------------------------- rendering


def render(event: ActivityEvent) -> Rendered:
    p = event.payload or {}
    actor = event.actor_display or "Someone"
    title = p.get("title") or p.get("task_title") or p.get("project_name") or ""
    project = p.get("project_name") or ""
    where = f" · {project}" if project and title != project else ""
    name = event.name
    url = ""
    if event.target_type == "task":
        url = f"/tasks/{'business' if p.get('kind') == 'business' else 'personal'}?task={event.target_id}"
        if event.project_id:
            url = f"/projects/{event.project_id}/tasks?task={event.target_id}"
    elif event.target_type == "project" and event.project_id:
        url = f"/projects/{event.project_id}"
    elif event.target_type == "share":
        url = "/settings/sharing"

    if name == EventName.TASK_COMPLETED:
        return Rendered(f"{actor} completed “{title}”", where.strip(" ·"), url)
    if name == EventName.TASK_REOPENED:
        return Rendered(f"{actor} reopened “{title}”", where.strip(" ·"), url)
    if name == EventName.TASK_CREATED:
        return Rendered(f"{actor} added “{title}”", where.strip(" ·"), url)
    if name == EventName.SUBTASK_COMPLETED:
        return Rendered(f"{actor} completed subtask “{title}”", p.get("parent_title", ""), url)
    if name == EventName.SUBTASK_CREATED:
        return Rendered(f"{actor} added subtask “{title}”", p.get("parent_title", ""), url)
    if name == EventName.TASK_ASSIGNED:
        return Rendered(f"{actor} assigned “{title}” to {p.get('assignee') or 'you'}", where.strip(" ·"), url)
    if name == EventName.TASK_DEADLINE_CHANGED:
        return Rendered(f"Deadline changed: “{title}”", f"by {actor}{where}", url)
    if name == EventName.COMMENT_CREATED:
        return Rendered(f"{actor} commented on “{title or project}”", p.get("excerpt", ""), url)
    if name == EventName.PROJECT_MEMBER_JOINED:
        return Rendered(f"{p.get('member') or actor} joined {project}", f"as {p.get('role', 'member')}", url)
    if name == EventName.PROJECT_MEMBER_REMOVED:
        verb = "left" if p.get("left") else "was removed from"
        return Rendered(f"{p.get('member') or actor} {verb} {project}", "", url)
    if name == EventName.PROJECT_MODE_CHANGED:
        return Rendered(f"{project} is now {p.get('mode', '')}", f"changed by {actor}", url)
    if name == EventName.SHARE_TASK_COMPLETED:
        return Rendered(f"{p.get('guest') or 'A guest'} completed “{title}”", "via share link", url)
    if name == EventName.SHARE_TASK_REOPENED:
        return Rendered(f"{p.get('guest') or 'A guest'} reopened “{title}”", "via share link", url)
    if name == EventName.SHARE_OPENED:
        return Rendered(f"Share link opened: {title}", "", url)
    if name == EventName.SHARE_GUEST_IDENTIFIED:
        return Rendered(f"{p.get('guest')} opened “{title}”", "via share link", url)
    if name == EventName.REMINDER_DUE:
        return Rendered(f"Reminder: {title}", p.get("message", ""), url)
    return Rendered(f"{actor}: {name.replace('.', ' ').replace('_', ' ')}", title, url)


# ----------------------------------------------------------------- fan-out


def fan_out(event_id: int) -> int:
    event = ActivityEvent.objects.filter(pk=event_id).select_related("actor_user").first()
    if event is None:
        return 0
    if event.name.startswith(("timer.", "sleep.", "prompt.", "idea.", "ai.")) or event.name == EventName.TASK_UPDATED:
        return 0
    rendered = render(event)
    count = 0
    from django.contrib.auth import get_user_model

    user_model = get_user_model()
    for user in user_model.objects.filter(pk__in=recipients_for(event), is_active=True).select_related("preferences"):
        prefs = preferences_for(user)
        if not wants(prefs, event.name):
            continue
        notification = None
        if prefs.in_app_enabled:
            notification = create_notification(
                user,
                title=rendered.title,
                body=rendered.body,
                url=rendered.url,
                category=CATEGORY.get(event.name, Notification.Category.TEAM),
                event_name=event.name,
                activity_event=event,
                dedupe_key=f"evt:{event.pk}",
                payload={
                    "target_type": event.target_type,
                    "target_id": event.target_id,
                    "project_id": event.project_id,
                },
            )
        if prefs.telegram_enabled and not in_quiet_hours(prefs, user):
            _queue_telegram(user, event, rendered, notification)
        count += 1
    return count


def create_notification(
    user,
    *,
    title: str,
    body: str = "",
    url: str = "",
    category: str = Notification.Category.SYSTEM,
    event_name: str = "",
    activity_event=None,
    dedupe_key: str = "",
    payload: dict | None = None,
):
    """Create + push an in-app notification. Duplicate dedupe keys are silently ignored."""
    try:
        with transaction.atomic():
            notification = Notification.objects.create(
                user=user,
                title=title[:200],
                body=body,
                url=url[:300],
                category=category,
                event_name=event_name,
                activity_event=activity_event,
                dedupe_key=dedupe_key[:120],
                payload=payload or {},
            )
    except IntegrityError:
        return None
    _push(notification)
    return notification


def _push(notification: Notification) -> None:
    from apps.realtime import publisher

    publisher.publish_to_user(
        notification.user_id,
        {
            "type": "notification.new",
            "notification": {
                "id": notification.pk,
                "title": notification.title,
                "body": notification.body,
                "url": notification.url,
                "category": notification.category,
                "created_at": notification.created_at.isoformat(),
            },
            "unread": unread_count(notification.user_id),
        },
    )


def _queue_telegram(user, event: ActivityEvent, rendered: Rendered, notification) -> None:
    from apps.telegram import services as telegram
    from apps.telegram.keyboards import task_actions_keyboard

    connection = telegram.linked_connection(user)
    if connection is None:
        return
    text = f"<b>{telegram.escape(rendered.title)}</b>"
    if rendered.body:
        text += f"\n{telegram.escape(rendered.body)}"
    markup = None
    if event.target_type == "task" and event.name in (
        EventName.TASK_ASSIGNED,
        EventName.TASK_DEADLINE_CHANGED,
        EventName.REMINDER_DUE,
    ):
        markup = task_actions_keyboard(event.target_id)
    telegram.queue_message(
        user,
        text=text,
        idempotency_key=f"evt:{event.pk}:u{user.pk}",
        reply_markup=markup,
        notification=notification,
        activity_event=event,
    )


def unread_count(user_id: int) -> int:
    return Notification.objects.filter(user_id=user_id, read_at__isnull=True).count()


def mark_read(user, ids: list[int] | None = None) -> int:
    qs = Notification.objects.filter(user=user, read_at__isnull=True)
    if ids is not None:
        qs = qs.filter(pk__in=ids)
    return qs.update(read_at=timezone.now())
