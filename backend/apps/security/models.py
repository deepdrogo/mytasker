"""
Security shield storage: the IP blocklist, an append-only log of everything suspicious, the address every account
signed up from, and the state of the owner-only security bot.
"""

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class BlockedIP(models.Model):
    class Source(models.TextChoices):
        AUTO = "auto", "Automatic (score)"
        TRAP = "trap", "Scanner trap"
        SIGNUP = "signup", "Registration abuse"
        MANUAL = "manual", "Manual"
        BOT = "bot", "Security bot"
        PURGE = "purge", "User purge"

    # Canonical single address (IPv4) or network (IPv6 /64, or any CIDR added by hand).
    network = models.CharField(max_length=64, unique=True)
    reason = models.CharField(max_length=200)
    source = models.CharField(max_length=10, choices=Source.choices, default=Source.AUTO)
    is_active = models.BooleanField(default=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)  # null = permanent
    # How many times this network has been banned; every new ban is longer than the last.
    offenses = models.PositiveIntegerField(default=1)
    hits = models.PositiveIntegerField(default=0)
    last_hit_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    cf_rule_id = models.CharField(max_length=64, blank=True)

    class Meta:
        db_table = "security_blocked_ip"
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return self.network

    @property
    def is_permanent(self) -> bool:
        return self.expires_at is None

    @property
    def is_effective(self) -> bool:
        return self.is_active and (self.expires_at is None or self.expires_at > timezone.now())


class SecurityEvent(models.Model):
    class Kind(models.TextChoices):
        BLOCKED = "blocked", "Blocked IP request"
        BAD_UA = "bad_ua", "Hacker tool / bot user agent"
        TRAP = "trap", "Scanner trap"
        INJECTION = "injection", "Injection / traversal payload"
        ORIGIN = "origin", "Cross-site or scripted write"
        CSRF = "csrf", "CSRF check failed"
        LOGIN_FAILED = "login_failed", "Failed login"
        ADMIN_LOGIN = "admin_login", "Admin login"
        SIGNUP = "signup", "New registration"
        SIGNUP_BLOCKED = "signup_blocked", "Registration refused"
        HONEYPOT = "honeypot", "Honeypot filled"
        ENUMERATION = "enumeration", "Probing / enumeration"
        RATE_LIMITED = "rate_limited", "Rate limited"
        SSRF = "ssrf", "Server-side request forgery attempt"
        AUTO_BAN = "auto_ban", "IP banned automatically"
        MANUAL_BAN = "manual_ban", "IP banned by hand"
        UNBAN = "unban", "IP unbanned"
        USER_PURGED = "user_purged", "User purged"
        BOT_INTRUDER = "bot_intruder", "Stranger wrote to the security bot"
        SSH_LOGIN = "ssh_login", "SSH login"

    class Severity(models.TextChoices):
        INFO = "info", "Info"
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    severity = models.CharField(max_length=10, choices=Severity.choices, default=Severity.LOW)
    ip = models.GenericIPAddressField(null=True, blank=True)
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=300, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    country = models.CharField(max_length=4, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="security_events"
    )
    points = models.PositiveSmallIntegerField(default=0)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "security_event"
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["ip", "-created_at"], name="secevent_ip"),
            models.Index(fields=["kind", "-created_at"], name="secevent_kind"),
        ]

    def __str__(self) -> str:
        return f"{self.kind}:{self.ip}"


class SignupRecord(models.Model):
    """Where an account was created from. Deleted together with the account."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="signup_record")
    ip = models.GenericIPAddressField(null=True, blank=True, db_index=True)
    user_agent = models.CharField(max_length=300, blank=True)
    country = models.CharField(max_length=4, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "security_signup_record"
        ordering = ["-id"]

    def __str__(self) -> str:
        return f"signup:{self.user_id}:{self.ip}"


class SecurityBotState(models.Model):
    """Single row (pk=1). Once the owner has written to the bot, only that Telegram user id is ever obeyed."""

    owner_user_id = models.BigIntegerField(null=True, blank=True)
    owner_chat_id = models.BigIntegerField(null=True, blank=True)
    owner_username = models.CharField(max_length=64, blank=True)
    bound_at = models.DateTimeField(null=True, blank=True)
    last_update_id = models.BigIntegerField(default=0)

    class Meta:
        db_table = "security_bot_state"

    def __str__(self) -> str:
        return f"SecurityBotState(owner={self.owner_user_id})"

    @classmethod
    def load(cls) -> SecurityBotState:
        state, _ = cls.objects.get_or_create(pk=1)
        return state
