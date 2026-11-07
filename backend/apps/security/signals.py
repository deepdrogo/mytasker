"""Login outcomes feed the shield: failures are scored, every staff login is reported to the owner."""

from __future__ import annotations

from django.contrib.auth.signals import user_logged_in, user_login_failed
from django.dispatch import receiver

from apps.security import guard, notify
from apps.security.ip import client_ip, country, is_trusted, user_agent
from apps.security.models import SecurityEvent

Kind = SecurityEvent.Kind
Severity = SecurityEvent.Severity


@receiver(user_login_failed)
def on_login_failed(sender, credentials=None, request=None, **kwargs):
    if request is None:
        return
    admin = getattr(request, "path", "").startswith("/admin")
    username = str((credentials or {}).get("username") or "")[:120]
    guard.flag(
        request,
        kind=Kind.LOGIN_FAILED,
        points=25 if admin else 12,
        severity=Severity.MEDIUM if admin else Severity.LOW,
        details={"account": username, "admin_panel": admin},
    )


@receiver(user_logged_in)
def on_logged_in(sender, request=None, user=None, **kwargs):
    if request is None or user is None or not user.is_staff:
        return
    ip = client_ip(request)
    seen = SecurityEvent.objects.filter(kind=Kind.ADMIN_LOGIN, user=user, ip=ip).exists() if ip else True
    SecurityEvent.objects.create(
        kind=Kind.ADMIN_LOGIN,
        severity=Severity.INFO if seen or is_trusted(ip) else Severity.HIGH,
        ip=ip,
        method=request.method,
        path=request.path[:300],
        user_agent=user_agent(request),
        country=country(request),
        user=user,
    )
    notify.admin_login_alert(
        user, ip=ip, ua=user_agent(request), country=country(request), new_ip=not seen and not is_trusted(ip)
    )
