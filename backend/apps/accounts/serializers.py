from __future__ import annotations

from zoneinfo import available_timezones

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.accounts.models import User, UserPreference
from apps.notifications.models import NotificationPreference

_TIMEZONES = available_timezones()


def _validate_timezone(value: str) -> str:
    if value not in _TIMEZONES:
        raise serializers.ValidationError("Unknown timezone.")
    return value


class PasswordField(serializers.CharField):
    def __init__(self, **kwargs):
        kwargs.setdefault("write_only", True)
        kwargs.setdefault("trim_whitespace", False)
        kwargs.setdefault("max_length", 200)
        super().__init__(**kwargs)


class UserPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserPreference
        fields = [
            "first_day_of_week",
            "time_format",
            "default_task_type",
            "default_reminder_minutes",
            "business_hours_target_minutes",
            "sleep_target_minutes",
            "planned_bedtime",
            "planned_wake_time",
            "morning_summary_enabled",
            "morning_summary_time",
            "evening_summary_enabled",
            "evening_summary_time",
            "weekly_review_enabled",
            "monthly_review_enabled",
        ]

    def validate_first_day_of_week(self, value: int) -> int:
        if value not in (0, 1):
            raise serializers.ValidationError("Use 0 for Sunday or 1 for Monday.")
        return value


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = [
            "mode",
            "telegram_enabled",
            "in_app_enabled",
            "on_task_created",
            "on_task_completed",
            "on_task_reopened",
            "on_subtask_created",
            "on_subtask_completed",
            "on_comment_created",
            "on_deadline_changed",
            "on_assignment_changed",
            "on_member_joined",
            "on_member_removed",
            "on_share_task_completed",
            "on_share_opened",
            "on_reminder",
            "quiet_hours_start",
            "quiet_hours_end",
        ]


class MeSerializer(serializers.ModelSerializer):
    preferences = UserPreferenceSerializer(read_only=True)
    notification_preferences = NotificationPreferenceSerializer(read_only=True)
    display_name = serializers.CharField(read_only=True)
    email_verified = serializers.SerializerMethodField()
    telegram_linked = serializers.SerializerMethodField()
    ai_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "email",
            "full_name",
            "display_name",
            "timezone",
            "locale",
            "email_verified",
            "telegram_linked",
            "is_staff",
            "ai_enabled",
            "created_at",
            "preferences",
            "notification_preferences",
        ]
        read_only_fields = fields

    def get_email_verified(self, obj: User) -> bool:
        return obj.is_email_verified

    def get_telegram_linked(self, obj: User) -> bool:
        connection = getattr(obj, "telegram_connection", None)
        return bool(connection and connection.is_linked)

    def get_ai_enabled(self, obj: User) -> bool:
        from apps.ai.access import ai_enabled_for

        return ai_enabled_for(obj)


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = PasswordField()
    full_name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    timezone = serializers.CharField(max_length=64, required=False, default="UTC", validators=[_validate_timezone])

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = PasswordField()


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)
    password = PasswordField()

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = PasswordField()
    new_password = PasswordField()

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value, user=self.context.get("user"))
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=200)


def _validate_locale(value: str) -> str:
    from django.conf import settings

    if value not in settings.SUPPORTED_LANGUAGES:
        raise serializers.ValidationError("Unsupported language.")
    return value


class ProfileUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    timezone = serializers.CharField(max_length=64, required=False, validators=[_validate_timezone])
    locale = serializers.CharField(max_length=10, required=False, validators=[_validate_locale])
