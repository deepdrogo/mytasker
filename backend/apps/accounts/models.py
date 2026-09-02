from __future__ import annotations

from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from common.models import Source, TimeStampedModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email: str, password: str | None, **extra):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        UserPreference.objects.get_or_create(user=user)
        return user

    def create_user(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra)

    def create_superuser(self, email: str, password: str | None = None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("is_active", True)
        extra.setdefault("email_verified_at", timezone.now())
        return self._create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    email = models.EmailField(unique=True, max_length=254)
    full_name = models.CharField(max_length=120, blank=True)
    timezone = models.CharField(max_length=64, default="UTC")
    locale = models.CharField(max_length=10, default="en")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "accounts_user"
        indexes = [models.Index(fields=["email"])]

    def __str__(self) -> str:
        return self.email

    @property
    def display_name(self) -> str:
        return self.full_name.strip() or self.email.split("@")[0]

    @property
    def is_email_verified(self) -> bool:
        return self.email_verified_at is not None


class UserPreference(TimeStampedModel):
    class TaskType(models.TextChoices):
        PERSONAL = "personal", "Personal"
        BUSINESS = "business", "Business"

    class TimeFormat(models.TextChoices):
        H24 = "24h", "24-hour"
        H12 = "12h", "12-hour"

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="preferences")

    first_day_of_week = models.PositiveSmallIntegerField(default=1)  # 0 = Sunday, 1 = Monday
    time_format = models.CharField(max_length=3, choices=TimeFormat.choices, default=TimeFormat.H24)
    default_task_type = models.CharField(max_length=10, choices=TaskType.choices, default=TaskType.PERSONAL)
    default_reminder_minutes = models.PositiveIntegerField(default=30)

    # Daily targets
    business_hours_target_minutes = models.PositiveIntegerField(default=600)
    sleep_target_minutes = models.PositiveIntegerField(default=480)
    planned_bedtime = models.TimeField(null=True, blank=True)
    planned_wake_time = models.TimeField(null=True, blank=True)

    # Summaries (local time)
    morning_summary_enabled = models.BooleanField(default=True)
    morning_summary_time = models.TimeField(default="08:00")
    evening_summary_enabled = models.BooleanField(default=True)
    evening_summary_time = models.TimeField(default="22:00")
    weekly_review_enabled = models.BooleanField(default=True)
    monthly_review_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "accounts_user_preference"

    def __str__(self) -> str:
        return f"Preferences({self.user_id})"


class EmailToken(TimeStampedModel):
    """Single-use tokens for email verification and password reset (hash stored, never the token)."""

    class Purpose(models.TextChoices):
        VERIFY_EMAIL = "verify_email", "Verify email"
        RESET_PASSWORD = "reset_password", "Reset password"

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="email_tokens")
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "accounts_email_token"
        indexes = [models.Index(fields=["user", "purpose", "used_at"])]

    @property
    def is_usable(self) -> bool:
        return self.used_at is None and self.expires_at > timezone.now()


class LoginEvent(models.Model):
    """Lightweight session/login audit (no credentials stored)."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_events")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)
    ip_hash = models.CharField(max_length=64, blank=True)
    user_agent = models.CharField(max_length=255, blank=True)
    success = models.BooleanField(default=True)

    class Meta:
        db_table = "accounts_login_event"
        indexes = [models.Index(fields=["user", "-created_at"])]

    def __str__(self) -> str:
        return f"login:{self.user_id}:{self.source}"
