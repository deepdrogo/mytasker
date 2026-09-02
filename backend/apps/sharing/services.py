from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.sharing.models import ShareGuestSession, ShareLink, ShareLinkItem
from apps.tasks import services as task_services
from apps.tasks.models import Task
from common.actors import Actor
from common.events import DomainEvent, EventName, emit
from common.exceptions import Forbidden, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import Capability, can_edit_object

GUEST_SESSION_TTL = timedelta(days=30)
MAX_TASKS_PER_SHARE = 200


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def build_share_url(token: str) -> str:
    return f"{settings.SITE_URL.rstrip('/')}/s/{token}"


# ------------------------------------------------------------------ owner side


@transaction.atomic
def create_share(
    actor: Actor,
    *,
    task_ids: list[int],
    title: str = "",
    password: str | None = None,
    expires_at: datetime | None = None,
    ask_guest_name: bool = True,
    allow_complete: bool = True,
    allow_reopen: bool = False,
    one_time: bool = False,
    max_uses: int | None = None,
) -> tuple[ShareLink, str]:
    user = actor.user
    ids = list(dict.fromkeys(task_ids))[:MAX_TASKS_PER_SHARE]
    if not ids:
        raise ValidationFailed("Select at least one task.", fields={"task_ids": ["Required."]})
    tasks = list(Task.objects.select_related("project").filter(pk__in=ids))
    if len(tasks) != len(ids):
        raise NotFound("Some tasks were not found.")
    for task in tasks:
        # Only people who could edit the task may hand out a link that lets others complete it.
        if not can_edit_object(
            user,
            owner_id=task.owner_id,
            project=task.project,
            visibility=task.visibility,
            capability=Capability.COMPLETE_TASK,
        ):
            raise Forbidden(f"You cannot share “{task.title}”.")
    if expires_at is not None and expires_at <= timezone.now():
        raise ValidationFailed("Expiry must be in the future.", fields={"expires_at": ["In the past."]})
    if password is not None and password != "" and len(password) < 4:
        raise ValidationFailed("Password is too short.", fields={"password": ["At least 4 characters."]})

    token = secrets.token_urlsafe(32)
    share = ShareLink.objects.create(
        owner=user,
        title=(title or "").strip()[:200] or (tasks[0].title if len(tasks) == 1 else f"{len(tasks)} tasks"),
        token_hash=_hash(token),
        token_prefix=token[:6],
        password_hash=make_password(password) if password else "",
        expires_at=expires_at,
        ask_guest_name=ask_guest_name,
        allow_complete=allow_complete,
        allow_reopen=allow_reopen,
        one_time=one_time,
        max_uses=max_uses,
    )
    order = {task_id: i for i, task_id in enumerate(ids)}
    ShareLinkItem.objects.bulk_create([ShareLinkItem(share=share, task=t, order=order[t.pk]) for t in tasks])
    emit(
        DomainEvent(
            name=EventName.SHARE_CREATED,
            actor=actor,
            target_type="share",
            target_id=share.pk,
            owner_user_id=user.pk,
            visibility=Visibility.PRIVATE,
            payload={"share_id": share.pk, "title": share.title, "task_count": len(tasks)},
        )
    )
    return share, token


@transaction.atomic
def update_share(actor: Actor, share_id: int, **fields) -> ShareLink:
    share = ShareLink.objects.filter(pk=share_id, owner=actor.user).first()
    if share is None:
        raise NotFound("Share link not found.")
    if "password" in fields:
        password = fields.pop("password")
        share.password_hash = make_password(password) if password else ""
    for key in ("title", "expires_at", "ask_guest_name", "allow_complete", "allow_reopen", "one_time", "max_uses"):
        if key in fields:
            setattr(share, key, fields[key])
    share.save()
    return share


@transaction.atomic
def revoke_share(actor: Actor, share_id: int) -> ShareLink:
    share = ShareLink.objects.filter(pk=share_id, owner=actor.user).first()
    if share is None:
        raise NotFound("Share link not found.")
    if share.revoked_at is None:
        share.revoked_at = timezone.now()
        share.save(update_fields=["revoked_at", "updated_at"])
    return share


@transaction.atomic
def delete_share(actor: Actor, share_id: int) -> None:
    deleted, _ = ShareLink.objects.filter(pk=share_id, owner=actor.user).delete()
    if not deleted:
        raise NotFound("Share link not found.")


# ------------------------------------------------------------------ guest side


class ShareAccess:
    """Resolved guest access to a share link."""

    def __init__(self, share: ShareLink, session: ShareGuestSession | None):
        self.share = share
        self.session = session

    @property
    def authenticated(self) -> bool:
        return not self.share.requires_password or self.session is not None


def resolve_share(token: str, session_token: str | None = None) -> ShareLink:
    """
    Resolve a share by its raw token. A guest who already holds a valid session for a one-time /
    max-uses link keeps access after the link is exhausted; new visitors are refused.
    """
    if not token or len(token) > 128:
        raise NotFound("This link does not exist.")
    share = ShareLink.objects.filter(token_hash=_hash(token)).first()
    if share is None:
        raise NotFound("This link does not exist.")
    if share.revoked_at is not None:
        raise Forbidden("This link was revoked.", code="share_revoked")
    if share.is_expired:
        raise Forbidden("This link has expired.", code="share_expired")
    if share.is_exhausted and resolve_session(share, session_token) is None:
        raise Forbidden("This link has already been used.", code="share_exhausted")
    return share


def resolve_session(share: ShareLink, session_token: str | None) -> ShareGuestSession | None:
    if not session_token:
        return None
    session = ShareGuestSession.objects.filter(share=share, session_token_hash=_hash(session_token)).first()
    if session is None:
        return None
    if session.expires_at and session.expires_at <= timezone.now():
        return None
    return session


def _client_fingerprint(request) -> tuple[str, str]:
    ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR", "")
    ua = request.META.get("HTTP_USER_AGENT", "")[:255]
    return (_hash(ip) if ip else "", ua)


@transaction.atomic
def open_share(
    share: ShareLink, request, *, session_token: str | None
) -> tuple[ShareGuestSession | None, str | None]:
    """
    Record an open. Creates a guest session for links without password (password-protected
    links get their session in `unlock_share`). Returns (session, new_session_token_or_None).
    """
    session = resolve_session(share, session_token)
    new_token = None
    if session is None and not share.requires_password:
        session, new_token = _create_session(share, request, guest_name="")
        _count_use(share, session)
    elif session is not None:
        ShareGuestSession.objects.filter(pk=session.pk).update(last_seen_at=timezone.now())
    return session, new_token


def _create_session(share: ShareLink, request, *, guest_name: str) -> tuple[ShareGuestSession, str]:
    token = secrets.token_urlsafe(32)
    ip_hash, ua = _client_fingerprint(request)
    session = ShareGuestSession.objects.create(
        share=share,
        guest_name=guest_name[:80],
        session_token_hash=_hash(token),
        ip_hash=ip_hash,
        user_agent=ua,
        expires_at=timezone.now() + GUEST_SESSION_TTL,
    )
    return session, token


def _count_use(share: ShareLink, session: ShareGuestSession) -> None:
    ShareLink.objects.filter(pk=share.pk).update(use_count=F("use_count") + 1, last_opened_at=timezone.now())
    share.refresh_from_db(fields=["use_count", "last_opened_at"])
    emit(
        DomainEvent(
            name=EventName.SHARE_OPENED,
            actor=Actor.guest(session),
            target_type="share",
            target_id=share.pk,
            owner_user_id=share.owner_id,
            visibility=Visibility.PRIVATE,
            payload={"share_id": share.pk, "title": share.title, "guest": session.display_name},
        )
    )


@transaction.atomic
def unlock_share(share: ShareLink, request, *, password: str) -> tuple[ShareGuestSession, str]:
    if not share.requires_password:
        raise ValidationFailed("This link has no password.")
    if not check_password(password or "", share.password_hash):
        raise Forbidden("Wrong password.", code="share_wrong_password")
    session, token = _create_session(share, request, guest_name="")
    _count_use(share, session)
    return session, token


@transaction.atomic
def identify_guest(share: ShareLink, session: ShareGuestSession, *, name: str) -> ShareGuestSession:
    name = (name or "").strip()[:80]
    if not name:
        raise ValidationFailed("Please enter your name.", fields={"name": ["Required."]})
    changed = session.guest_name != name
    session.guest_name = name
    session.save(update_fields=["guest_name", "last_seen_at", "updated_at"])
    if changed:
        emit(
            DomainEvent(
                name=EventName.SHARE_GUEST_IDENTIFIED,
                actor=Actor.guest(session),
                target_type="share",
                target_id=share.pk,
                owner_user_id=share.owner_id,
                visibility=Visibility.PRIVATE,
                payload={"share_id": share.pk, "title": share.title, "guest": name},
            )
        )
    return session


def shared_tasks(share: ShareLink):
    ids = list(share.items.values_list("task_id", flat=True))
    tasks = Task.objects.filter(pk__in=ids).select_related("project")
    subtasks = Task.objects.filter(parent_id__in=ids).order_by("sort_order", "id")
    return tasks, subtasks


def _guest_task(share: ShareLink, task_id: int) -> Task:
    ids = set(share.items.values_list("task_id", flat=True))
    task = Task.objects.select_for_update(of=("self",)).select_related("project", "parent").filter(pk=task_id).first()
    if task is None or (task.pk not in ids and task.parent_id not in ids):
        raise NotFound("Task not found in this share.")
    return task


@transaction.atomic
def guest_complete(share: ShareLink, session: ShareGuestSession, task_id: int) -> Task:
    if not share.allow_complete:
        raise Forbidden("Completing tasks is disabled for this link.")
    if share.ask_guest_name and not session.guest_name:
        raise ValidationFailed("Please tell us your name first.", code="guest_name_required")
    task = _guest_task(share, task_id)
    actor = Actor.guest(session)
    task = task_services.mark_complete(task, actor, cascade_subtasks=True)
    emit(
        DomainEvent(
            name=EventName.SHARE_TASK_COMPLETED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            owner_user_id=task.owner_id,
            project_id=task.project_id,
            visibility=task.visibility if task.project_id else Visibility.PRIVATE,
            payload={"task_id": task.pk, "title": task.title, "guest": session.display_name, "share_id": share.pk},
        )
    )
    return task


@transaction.atomic
def guest_reopen(share: ShareLink, session: ShareGuestSession, task_id: int) -> Task:
    if not share.allow_reopen:
        raise Forbidden("Reopening tasks is disabled for this link.")
    task = _guest_task(share, task_id)
    actor = Actor.guest(session)
    task = task_services.mark_reopened(task, actor)
    emit(
        DomainEvent(
            name=EventName.SHARE_TASK_REOPENED,
            actor=actor,
            target_type="task",
            target_id=task.pk,
            owner_user_id=task.owner_id,
            project_id=task.project_id,
            visibility=task.visibility if task.project_id else Visibility.PRIVATE,
            payload={"task_id": task.pk, "title": task.title, "guest": session.display_name, "share_id": share.pk},
        )
    )
    return task
