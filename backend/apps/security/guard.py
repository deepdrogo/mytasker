"""
The scoring engine. Every suspicious thing an address does adds points inside a rolling window; at the threshold the
address is banned (with escalating duration) and the owner is told on Telegram.
"""

from __future__ import annotations

import logging
import zlib
from contextvars import ContextVar
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache

from apps.security import blocklist, notify
from apps.security.ip import ban_network, client_ip, country, is_trusted, user_agent
from apps.security.models import BlockedIP, SecurityEvent

logger = logging.getLogger("mytasker.security")

Kind = SecurityEvent.Kind
Severity = SecurityEvent.Severity

current_request: ContextVar = ContextVar("security_current_request", default=None)

SCORE_KEY = "sec:score:{}"
EVENT_DEDUPE_KEY = "sec:evt:{}:{}:{}"

# Kinds that are worth a Telegram message on their own (others only surface through bans and the digest).
ALERT_KINDS = {Kind.TRAP, Kind.INJECTION, Kind.HONEYPOT, Kind.SSRF, Kind.SIGNUP_BLOCKED, Kind.ADMIN_LOGIN}

KIND_TITLES = {
    Kind.BLOCKED: "დაბლოკილი IP-ის მოთხოვნა",
    Kind.BAD_UA: "ჰაკერული ხელსაწყო (curl/სკანერი)",
    Kind.TRAP: "სკანერის ხაფანგი (.env/.git/wp-…)",
    Kind.INJECTION: "ინექციის / traversal მცდელობა",
    Kind.ORIGIN: "სკრიპტით ჩაწერის მცდელობა (Origin)",
    Kind.CSRF: "CSRF შემოწმება ჩავარდა",
    Kind.LOGIN_FAILED: "წარუმატებელი შესვლა",
    Kind.ADMIN_LOGIN: "ადმინის შესვლა",
    Kind.SIGNUP: "ახალი რეგისტრაცია",
    Kind.SIGNUP_BLOCKED: "რეგისტრაცია უარყოფილია",
    Kind.HONEYPOT: "ბოტმა honeypot შეავსო",
    Kind.ENUMERATION: "ზონდირება / enumeration",
    Kind.RATE_LIMITED: "ლიმიტს გადააჭარბა",
    Kind.SSRF: "SSRF მცდელობა",
    Kind.AUTO_BAN: "IP ავტომატურად დაიბლოკა",
    Kind.MANUAL_BAN: "IP ხელით დაიბლოკა",
    Kind.UNBAN: "IP განიბლოკა",
    Kind.USER_PURGED: "მომხმარებელი წაიშალა",
    Kind.BOT_INTRUDER: "უცხომ მისწერა უსაფრთხოების ბოტს",
    Kind.SSH_LOGIN: "SSH შესვლა",
}


def _threshold() -> int:
    return int(getattr(settings, "SECURITY_BAN_THRESHOLD", 100))


def _window() -> int:
    return int(getattr(settings, "SECURITY_SCORE_WINDOW_SECONDS", 3600))


def add_points(ip: str, points: int) -> int:
    key = SCORE_KEY.format(ban_network(ip))
    try:
        if cache.add(key, points, _window()):
            return points
        return int(cache.incr(key, points))
    except ValueError:  # expired between add and incr
        cache.set(key, points, _window())
        return points
    except Exception:  # noqa: BLE001 - scoring is best effort
        logger.warning("score update failed", extra={"ip": ip})
        return 0


def score(ip: str) -> int:
    try:
        return int(cache.get(SCORE_KEY.format(ban_network(ip))) or 0)
    except Exception:  # noqa: BLE001
        return 0


def reset_score(ip: str) -> None:
    cache.delete(SCORE_KEY.format(ban_network(ip)))


def _is_privileged(user) -> bool:
    return bool(user is not None and getattr(user, "is_authenticated", False) and getattr(user, "is_staff", False))


def flag(
    request=None,
    *,
    kind: str,
    points: int = 0,
    severity: str = Severity.LOW,
    ip: str | None = None,
    details: dict | None = None,
    user=None,
    path: str | None = None,
    ban_source: str = BlockedIP.Source.AUTO,
    unique_path: bool = False,
) -> BlockedIP | None:
    """
    Record a suspicious action and score it. Returns the ban if this pushed the address over the threshold.
    The same address+kind+path is logged at most once per 10 seconds so a flood cannot flood the table.
    """
    if request is None and ip is None:
        request = current_request.get()
    django_request = getattr(request, "_request", request)
    ip = ip or (client_ip(django_request) if django_request is not None else None)
    if not ip or is_trusted(ip):
        return None
    if user is None and django_request is not None:
        candidate = getattr(django_request, "user", None)
        user = candidate if getattr(candidate, "is_authenticated", False) else None
    if _is_privileged(user) and kind not in (Kind.ADMIN_LOGIN,):
        return None
    method = getattr(django_request, "method", "") or ""
    path = (path if path is not None else getattr(django_request, "path", "")) or ""
    ua = user_agent(django_request) if django_request is not None else ""

    dedupe = EVENT_DEDUPE_KEY.format(kind, ip, zlib.crc32(path.encode()))
    try:
        fresh = cache.add(dedupe, 1, 10)
    except Exception:  # noqa: BLE001
        fresh = True
    if fresh:
        try:
            SecurityEvent.objects.create(
                kind=kind,
                severity=severity,
                ip=ip,
                method=method[:10],
                path=path[:300],
                user_agent=ua,
                country=country(django_request) if django_request is not None else "",
                user=user,
                points=min(points, 32767),
                details=details or {},
            )
        except Exception:  # noqa: BLE001 - never break a request because logging failed
            logger.exception("security event write failed")
        if kind in ALERT_KINDS:
            notify.event_alert(kind=kind, ip=ip, path=path, ua=ua, details=details or {}, user=user)

    if points > 0 and unique_path:
        # Hitting the same missing URL again is a stale tab; walking through many ids is enumeration.
        try:
            if not cache.add(f"sec:seen:{ip}:{zlib.crc32(path.encode())}", 1, 600):
                points = 0
        except Exception:  # noqa: BLE001
            pass
    if points <= 0:
        return None
    total = add_points(ip, points)
    if total < _threshold() or blocklist.find(ip):
        return None
    return ban(ip, reason=f"{KIND_TITLES.get(kind, kind)} · score {total}", source=ban_source, kind=kind, path=path)


def ban(
    ip: str,
    *,
    reason: str,
    source: str = BlockedIP.Source.AUTO,
    kind: str = "",
    path: str = "",
    minimum: timedelta | None = timedelta(hours=1),
    permanent: bool = False,
    announce: bool = True,
) -> BlockedIP | None:
    row = blocklist.block(ip, reason=reason, source=source, minimum=minimum, permanent=permanent)
    if row is None:
        return None
    probe = ip.split("/", 1)[0]
    reset_score(probe)
    manual = source in (BlockedIP.Source.MANUAL, BlockedIP.Source.BOT, BlockedIP.Source.PURGE)
    SecurityEvent.objects.create(
        kind=Kind.MANUAL_BAN if manual else Kind.AUTO_BAN,
        severity=Severity.HIGH,
        ip=probe,
        path=path[:300],
        details={
            "network": row.network,
            "reason": reason,
            "expires_at": row.expires_at.isoformat() if row.expires_at else None,
            "offenses": row.offenses,
            "trigger": kind,
        },
    )
    if announce:
        notify.ban_alert(row, ip=ip, trigger=kind)
    return row
