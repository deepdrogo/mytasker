from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from apps.accounts.models import AssistantLink, EmailToken, LoginEvent, User, UserPreference
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


# --------------------------------------------------------------------------- assistant accounts

MAX_ASSISTANTS = 5
_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"  # no 0/O/1/l/I


def generate_assistant_password() -> str:
    """Readable one-time password: three groups of four unambiguous characters."""
    groups = ["".join(secrets.choice(_PASSWORD_ALPHABET) for _ in range(4)) for _ in range(3)]
    return "-".join(groups)


def _assistant_domain() -> str:
    host = settings.SITE_URL.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0] or "mytasker.io"
    return f"assistants.{host}"


def _generate_assistant_email(principal: User) -> str:
    for _ in range(20):
        candidate = f"assistant-{principal.pk}-{secrets.token_hex(3)}@{_assistant_domain()}"
        if not User.objects.filter(email=candidate).exists():
            return candidate
    raise Conflict("Could not allocate an assistant login. Try again.")


def assistants_for(principal: User):
    return User.objects.filter(assistant_for=principal).order_by("-is_active", "created_at")


def get_assistant(principal: User, assistant_id: int) -> User:
    assistant = assistants_for(principal).filter(pk=assistant_id).first()
    if assistant is None:
        from common.exceptions import NotFound

        raise NotFound("Assistant not found.")
    return assistant


@transaction.atomic
def create_assistant(principal: User, *, full_name: str, email: str | None = None) -> tuple[User, str]:
    """
    Create a restricted login that acts for `principal`. The generated password is returned exactly
    once; it is never stored in clear text.
    """
    if principal.is_assistant:
        raise Forbidden("Assistants cannot create assistants.")
    if assistants_for(principal).count() >= MAX_ASSISTANTS:
        raise ValidationFailed(f"You can have at most {MAX_ASSISTANTS} assistants.")
    full_name = (full_name or "").strip()
    if not full_name:
        raise ValidationFailed("Name is required.", fields={"full_name": ["This field is required."]})
    email = (email or "").strip().lower()
    if email:
        if User.objects.filter(email=email).exists():
            raise Conflict("An account with this email already exists.", fields={"email": ["Already registered."]})
    else:
        email = _generate_assistant_email(principal)

    password = generate_assistant_password()
    assistant = User.objects.create_user(
        email=email,
        password=password,
        full_name=full_name,
        timezone=principal.timezone,
        locale=principal.locale,
        assistant_for=principal,
        email_verified_at=timezone.now(),
    )
    NotificationPreference.objects.get_or_create(user=assistant)
    return assistant, password


@transaction.atomic
def reset_assistant_password(principal: User, assistant_id: int) -> tuple[User, str]:
    assistant = get_assistant(principal, assistant_id)
    password = generate_assistant_password()
    assistant.set_password(password)
    assistant.save(update_fields=["password"])
    return assistant, password


@transaction.atomic
def update_assistant(
    principal: User, assistant_id: int, *, full_name: str | None = None, is_active: bool | None = None
):
    assistant = get_assistant(principal, assistant_id)
    changed: list[str] = []
    if full_name is not None and full_name.strip():
        assistant.full_name = full_name.strip()
        changed.append("full_name")
    if is_active is not None and is_active != assistant.is_active:
        assistant.is_active = is_active
        changed.append("is_active")
    if changed:
        assistant.save(update_fields=changed)
    return assistant


@transaction.atomic
def remove_assistant(principal: User, assistant_id: int) -> None:
    """
    Disable the login but keep the account so `created_by` attribution on the principal's tasks
    survives. Existing sessions stop working because inactive users no longer authenticate.
    """
    assistant = get_assistant(principal, assistant_id)
    if assistant.is_active:
        assistant.is_active = False
        assistant.save(update_fields=["is_active"])


# --------------------------------------------------------------------------- linked assistants
# An existing account writes tasks for its principal from a "For <name>" page and sees only those.

MAX_LINKED_ASSISTANTS = 10


def linked_assistants(principal: User):
    """The principal's linked assistants, each with how many live tasks it wrote for them."""
    from django.db.models import Count, OuterRef, Subquery
    from django.db.models.functions import Coalesce

    from apps.tasks.models import Task

    written = (
        Task.objects.filter(owner_id=principal.pk, created_by_id=OuterRef("helper_id"))
        .values("created_by_id")
        .annotate(c=Count("id"))
        .values("c")[:1]
    )
    return (
        AssistantLink.objects.filter(principal=principal)
        .select_related("helper")
        .annotate(tasks_created=Coalesce(Subquery(written), 0))
        .order_by("created_at")
    )


@transaction.atomic
def link_assistant(principal: User, *, email: str) -> AssistantLink:
    if principal.is_assistant:
        raise Forbidden("Assistant accounts cannot have assistants.")
    target = User.objects.filter(email__iexact=(email or "").strip(), is_active=True).first()
    if target is None:
        raise ValidationFailed("No account with that e-mail.", fields={"email": ["Unknown account."]})
    if target.pk == principal.pk:
        raise ValidationFailed("You cannot add yourself.", fields={"email": ["That is you."]})
    if target.is_assistant:
        raise ValidationFailed(
            "This is already an assistant login. It writes for its own principal.",
            fields={"email": ["Assistant login."]},
        )
    existing = AssistantLink.objects.filter(principal=principal, helper=target).first()
    if existing is not None:
        return existing
    if AssistantLink.objects.filter(principal=principal).count() >= MAX_LINKED_ASSISTANTS:
        raise ValidationFailed(f"You can link at most {MAX_LINKED_ASSISTANTS} accounts.")
    return AssistantLink.objects.create(principal=principal, helper=target)


@transaction.atomic
def unlink_assistant(principal: User, link_id: int) -> None:
    """The account stops writing for the principal. Tasks it already added stay, still credited to it."""
    from common.exceptions import NotFound

    deleted, _ = AssistantLink.objects.filter(pk=link_id, principal=principal).delete()
    if not deleted:
        raise NotFound("Assistant not found.")


def helping(helper: User) -> list[dict]:
    """Whom this account writes for, with open / done counts of what it added. Drives the "For <name>" pages."""
    from django.db.models import Count, Q

    from apps.tasks.models import Task

    links = list(AssistantLink.objects.filter(helper=helper).select_related("principal").order_by("created_at"))
    counts = {
        row["owner_id"]: row
        for row in Task.objects.filter(
            created_by=helper, owner_id__in=[link.principal_id for link in links], project__isnull=True
        )
        .values("owner_id")
        .annotate(
            open_count=Count("id", filter=~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])),
            done_count=Count("id", filter=Q(status=Task.Status.DONE)),
        )
    }
    return [
        {
            "user": link.principal,
            "open_count": counts.get(link.principal_id, {}).get("open_count", 0),
            "done_count": counts.get(link.principal_id, {}).get("done_count", 0),
        }
        for link in links
    ]


@transaction.atomic
def update_preferences(user: User, **fields) -> UserPreference:
    prefs, _ = UserPreference.objects.get_or_create(user=user)
    changed = []
    for key, value in fields.items():
        if not hasattr(prefs, key):
            continue
        # `null` clears a nullable setting (bedtime, Crypto world dates); required ones ignore it.
        if value is None and not UserPreference._meta.get_field(key).null:
            continue
        setattr(prefs, key, value)
        changed.append(key)
    if changed:
        prefs.save(update_fields=changed)
    return prefs
