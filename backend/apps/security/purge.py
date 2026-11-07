"""Remove a hostile account completely and ban every address it is known to have used."""

from __future__ import annotations

import logging
from datetime import timedelta

from django.contrib.sessions.backends.cached_db import SessionStore
from django.contrib.sessions.models import Session
from django.db import transaction
from django.utils import timezone

from apps.security import guard
from apps.security.models import BlockedIP, SecurityEvent, SignupRecord

logger = logging.getLogger("mytasker.security")


class PurgeRefused(Exception):
    pass


def known_ips(user) -> list[str]:
    ips = set(SecurityEvent.objects.filter(user=user).exclude(ip=None).values_list("ip", flat=True))
    record = SignupRecord.objects.filter(user=user).values_list("ip", flat=True).first()
    if record:
        ips.add(record)
    return sorted(ips)


def kill_sessions(user_id: int) -> int:
    killed = 0
    for session in Session.objects.filter(expire_date__gt=timezone.now()).iterator():
        try:
            owner = session.get_decoded().get("_auth_user_id")
        except Exception:  # noqa: BLE001 - corrupt session rows are skipped
            continue
        if str(owner) == str(user_id):
            SessionStore(session_key=session.session_key).delete()
            killed += 1
    return killed


def purge_user(user_id: int, *, ban: bool = True, actor: str = "bot") -> dict:
    from apps.accounts.models import User
    from apps.projects.models import Project

    user = User.objects.filter(pk=user_id).first()
    if user is None:
        raise PurgeRefused("მომხმარებელი ვერ მოიძებნა.")
    if user.is_staff or user.is_superuser:
        raise PurgeRefused("ადმინის ანგარიშის წაშლა ბოტიდან აკრძალულია.")

    email = user.email
    ips = known_ips(user)
    sessions = kill_sessions(user.pk)
    with transaction.atomic():
        projects, _ = Project.all_objects.filter(owner=user).delete()
        assistants, _ = User.objects.filter(assistant_for=user).delete()
        deleted, by_model = user.delete()
    banned = []
    if ban:
        for ip in ips:
            row = guard.ban(
                ip,
                reason=f"წაშლილი ანგარიში {email}",
                source=BlockedIP.Source.PURGE,
                minimum=timedelta(days=30),
                announce=False,
            )
            if row is not None:
                banned.append(row.network)
    SecurityEvent.objects.create(
        kind=SecurityEvent.Kind.USER_PURGED,
        severity=SecurityEvent.Severity.HIGH,
        ip=ips[0] if ips else None,
        details={
            "user_id": user_id,
            "email": email,
            "actor": actor,
            "sessions": sessions,
            "rows": deleted + projects + assistants,
            "banned": banned,
        },
    )
    logger.warning("user purged", extra={"user_id": user_id, "actor": actor})
    return {"email": email, "sessions": sessions, "rows": deleted + projects + assistants, "banned": banned}
