from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import EmailToken, LoginEvent, User, UserPreference
from apps.notifications.models import NotificationPreference
from common.exceptions import Conflict, Forbidden, ValidationFailed
from common.models import Source


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_ip(ip: str | None) -> str:
    if not ip:
        return ""
    return hashlib.sha256(f"{settings.SECRET_KEY}:{ip}".encode()).hexdigest()[:32]


def _client_ip(request) -> str | None:
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


@transaction.atomic
def register_user(*, email: str, password: str, full_name: str = "", timezone_name: str = "UTC") -> User:
    email = email.strip().lower()
    if User.objects.filter(email=email).exists():
        raise Conflict("An account with this email already exists.", fields={"email": ["Already registered."]})
    user = User.objects.create_user(
        email=email,
        password=password,
        full_name=full_name.strip(),
        timezone=timezone_name or "UTC",
    )
    NotificationPreference.objects.get_or_create(user=user)
    transaction.on_commit(lambda: send_verification_email(user))
    return user


def ensure_side_models(user: User) -> None:
    UserPreference.objects.get_or_create(user=user)
    NotificationPreference.objects.get_or_create(user=user)


def issue_email_token(user: User, purpose: str, ttl_seconds: int) -> str:
    token = secrets.token_urlsafe(32)
    EmailToken.objects.filter(user=user, purpose=purpose, used_at__isnull=True).update(used_at=timezone.now())
    EmailToken.objects.create(
        user=user,
        purpose=purpose,
        token_hash=hash_token(token),
        expires_at=timezone.now() + timedelta(seconds=ttl_seconds),
    )
    return token


def consume_email_token(token: str, purpose: str) -> User:
    record = EmailToken.objects.select_related("user").filter(token_hash=hash_token(token), purpose=purpose).first()
    if record is None or not record.is_usable:
        raise ValidationFailed("This link is invalid or has expired.", fields={"token": ["Invalid or expired."]})
    record.used_at = timezone.now()
    record.save(update_fields=["used_at"])
    return record.user


def send_verification_email(user: User) -> None:
    if user.is_email_verified:
        return
    token = issue_email_token(user, EmailToken.Purpose.VERIFY_EMAIL, settings.EMAIL_VERIFICATION_MAX_AGE)
    url = f"{settings.SITE_URL}/auth/verify?token={token}"
    send_mail(
        subject="Verify your MyTasker email",
        message=f"Confirm your email address:\n\n{url}\n\nThe link expires in 48 hours.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


def verify_email(token: str) -> User:
    user = consume_email_token(token, EmailToken.Purpose.VERIFY_EMAIL)
    if not user.is_email_verified:
        user.email_verified_at = timezone.now()
        user.save(update_fields=["email_verified_at"])
    return user


def request_password_reset(email: str) -> None:
    """Always succeeds from the caller's perspective - never reveals whether an account exists."""
    user = User.objects.filter(email=email.strip().lower(), is_active=True).first()
    if user is None:
        return
    token = issue_email_token(user, EmailToken.Purpose.RESET_PASSWORD, settings.PASSWORD_RESET_MAX_AGE)
    url = f"{settings.SITE_URL}/auth/reset?token={token}"
    send_mail(
        subject="Reset your MyTasker password",
        message=(
            f"Reset your password:\n\n{url}\n\nThe link expires in 2 hours. Ignore this email if you did not ask."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=True,
    )


@transaction.atomic
def reset_password(token: str, new_password: str) -> User:
    user = consume_email_token(token, EmailToken.Purpose.RESET_PASSWORD)
    user.set_password(new_password)
    user.save(update_fields=["password"])
    return user


def login_user(request, *, email: str, password: str) -> User:
    email = email.strip().lower()
    user = authenticate(request, username=email, password=password)
    source = getattr(request, "client_source", Source.WEB)
    if user is None:
        existing = User.objects.filter(email=email).first()
        if existing is not None:
            LoginEvent.objects.create(
                user=existing,
                success=False,
                source=source,
                ip_hash=hash_ip(_client_ip(request)),
                user_agent=request.headers.get("User-Agent", "")[:255],
            )
        raise ValidationFailed("Incorrect email or password.", code="invalid_credentials")
    if not user.is_active:
        raise Forbidden("This account is disabled.")
    if settings.REQUIRE_EMAIL_VERIFICATION and not user.is_email_verified:
        raise Forbidden("Verify your email address before signing in.", code="email_not_verified")

    login(request, user)
    ensure_side_models(user)
    user.last_seen_at = timezone.now()
    user.save(update_fields=["last_seen_at"])
    LoginEvent.objects.create(
        user=user,
        success=True,
        source=source,
        ip_hash=hash_ip(_client_ip(request)),
        user_agent=request.headers.get("User-Agent", "")[:255],
    )
    return user


def logout_user(request) -> None:
    logout(request)


@transaction.atomic
def change_password(user: User, *, current_password: str, new_password: str) -> None:
    if not user.check_password(current_password):
        raise ValidationFailed("Current password is incorrect.", fields={"current_password": ["Incorrect password."]})
    user.set_password(new_password)
    user.save(update_fields=["password"])


@transaction.atomic
def update_profile(user: User, **fields) -> User:
    allowed = {"full_name", "timezone", "locale"}
    changed = []
    for key, value in fields.items():
        if key in allowed and value is not None:
            setattr(user, key, value)
            changed.append(key)
    if changed:
        user.save(update_fields=changed)
    return user


@transaction.atomic
def update_preferences(user: User, **fields) -> UserPreference:
    prefs, _ = UserPreference.objects.get_or_create(user=user)
    changed = []
    for key, value in fields.items():
        if value is not None and hasattr(prefs, key):
            setattr(prefs, key, value)
            changed.append(key)
    if changed:
        prefs.save(update_fields=changed)
    return prefs
