"""
Registration guard: no mass sign-ups, no scripted sign-ups.

Layers, cheapest first: honeypot field, CSRF token, throwaway mail domains, per-address attempt and account limits
(the IPv6 /64 counts as one address), and a site-wide circuit breaker that stops registration during a wave.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework.authentication import CSRFCheck

from apps.security import guard, notify
from apps.security.ip import ban_network, client_ip, country, is_trusted, user_agent
from apps.security.models import BlockedIP, SecurityEvent, SignupRecord
from common.exceptions import Forbidden, RateLimited, ValidationFailed

logger = logging.getLogger("mytasker.security")

Kind = SecurityEvent.Kind
Severity = SecurityEvent.Severity

HONEYPOT_FIELDS = ("mt_hp", "company", "website", "url", "phone_number")

DISPOSABLE_DOMAINS = frozenset(
    """
    mailinator.com guerrillamail.com guerrillamail.net guerrillamail.org sharklasers.com grr.la 10minutemail.com
    10minutemail.net temp-mail.org temp-mail.io tempmail.com tempmail.net tempmailo.com tempr.email yopmail.com
    yopmail.net yopmail.fr trashmail.com trashmail.de trashmail.net getnada.com nada.email dispostable.com
    maildrop.cc throwawaymail.com fakeinbox.com mintemail.com mohmal.com emailondeck.com burnermail.io
    mailnesia.com spamgourmet.com discard.email moakt.com tmail.ws tmpmail.org tmpmail.net mail.tm mail.gw
    emailfake.com fakemail.net mytemp.email tempinbox.com spambox.us mailcatch.com inboxkitten.com
    luxusmail.org minuteinbox.com 1secmail.com 1secmail.net 1secmail.org esiix.com wwjmp.com xojxe.com
    cock.li dropmail.me 33mail.com anonaddy.me getairmail.com mailpoof.com tempail.com etempmail.net
    """.split()  # noqa: SIM905
)


def _limits() -> dict:
    defaults = {
        "attempts_per_hour": 8,  # register calls per address, successful or not
        "accounts_per_day": 2,  # accounts created per address
        "min_gap_seconds": 600,  # between two accounts from one address
        "global_per_hour": 12,  # site-wide circuit breaker
    }
    return {**defaults, **getattr(settings, "SECURITY_SIGNUP_LIMITS", {})}


def _counter(key: str, ttl: int) -> int:
    try:
        if cache.add(key, 1, ttl):
            return 1
        return int(cache.incr(key))
    except Exception:  # noqa: BLE001
        return 0


def _refuse(request, reason: str, *, points: int, message: str, exc=ValidationFailed, severity=Severity.MEDIUM):
    guard.flag(
        request,
        kind=Kind.SIGNUP_BLOCKED,
        points=points,
        severity=severity,
        details={"reason": reason},
        ban_source=BlockedIP.Source.SIGNUP,
    )
    raise exc(message, code="signup_refused")


def enforce_csrf(request) -> None:
    """DRF skips CSRF for anonymous requests; the auth endpoints must not."""
    django_request = getattr(request, "_request", request)
    check = CSRFCheck(lambda _request: None)
    check.process_request(django_request)
    reason = check.process_view(django_request, None, (), {})
    if reason:
        guard.flag(
            request, kind=Kind.CSRF, points=25, severity=Severity.MEDIUM, details={"reason": str(reason)[:120]}
        )
        raise Forbidden("Security check failed. Reload the page and try again.", code="csrf_failed")


def check(request) -> None:
    """Raise before anything is created when this registration must not happen."""
    ip = client_ip(request)
    data = request.data if hasattr(request.data, "get") else {}

    for name in HONEYPOT_FIELDS:
        if str(data.get(name) or "").strip():
            guard.flag(
                request,
                kind=Kind.HONEYPOT,
                points=100,
                severity=Severity.HIGH,
                details={"field": name},
                ban_source=BlockedIP.Source.SIGNUP,
            )
            raise ValidationFailed("Registration failed. Try again later.", code="signup_refused")

    enforce_csrf(request)
    if ip is None or is_trusted(ip):
        return

    limits = _limits()
    net = ban_network(ip)
    if _counter(f"sec:signup:attempts:{net}", 3600) > limits["attempts_per_hour"]:
        _refuse(
            request,
            "too many attempts",
            points=30,
            exc=RateLimited,
            message="Too many registration attempts. Try again later.",
        )

    email = str(data.get("email") or "").strip().lower()
    domain = email.rsplit("@", 1)[-1] if "@" in email else ""
    if domain in DISPOSABLE_DOMAINS or any(domain.endswith(f".{d}") for d in DISPOSABLE_DOMAINS):
        _refuse(request, f"disposable domain {domain}", points=20, message="Use a permanent email address.")

    day_ago = timezone.now() - timedelta(hours=24)
    recent = SignupRecord.objects.filter(created_at__gte=day_ago)
    same_address = [r for r in recent.values_list("ip", "created_at") if r[0] and ban_network(r[0]) == net]
    if len(same_address) >= limits["accounts_per_day"]:
        _refuse(
            request,
            f"{len(same_address)} accounts in 24h",
            points=50,
            exc=RateLimited,
            message="Too many accounts from your network today.",
            severity=Severity.HIGH,
        )
    if same_address and max(t for _, t in same_address) > timezone.now() - timedelta(
        seconds=limits["min_gap_seconds"]
    ):
        _refuse(
            request,
            "accounts too close together",
            points=40,
            exc=RateLimited,
            message="Please wait a few minutes before creating another account.",
        )

    hour_ago = timezone.now() - timedelta(hours=1)
    if SignupRecord.objects.filter(created_at__gte=hour_ago).count() >= limits["global_per_hour"]:
        if cache.add("sec:signup:breaker-alert", 1, 1800):
            notify.send(
                "🚨 <b>რეგისტრაციის ტალღა!</b>\nსაათში ლიმიტი ამოიწურა — ახალი რეგისტრაციები "
                "დროებით შეჩერებულია. შეამოწმე /signups"
            )
        _refuse(
            request,
            "global circuit breaker",
            points=10,
            exc=RateLimited,
            message="Registration is paused for a moment. Try again later.",
            severity=Severity.HIGH,
        )


def record(user, request) -> SignupRecord:
    ip = client_ip(request)
    ua = user_agent(request)
    cc = country(request)
    signup = SignupRecord.objects.create(user=user, ip=ip, user_agent=ua, country=cc)
    same = 0
    if ip:
        net = ban_network(ip)
        window = SignupRecord.objects.filter(created_at__gte=timezone.now() - timedelta(days=90)).exclude(ip=None)
        same = sum(1 for (other,) in window.values_list("ip") if ban_network(other) == net)
    SecurityEvent.objects.create(
        kind=Kind.SIGNUP,
        severity=Severity.INFO,
        ip=ip,
        method="POST",
        path=getattr(getattr(request, "_request", request), "path", "")[:300],
        user_agent=ua,
        country=cc,
        user=user,
        details={"email": user.email},
    )
    notify.signup_alert(user, ip=ip, ua=ua, country=cc, same_ip_count=same)
    return signup
