from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.middleware.csrf import get_token
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from apps.accounts import services
from apps.accounts.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    MeSerializer,
    NotificationPreferenceSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    UserPreferenceSerializer,
    VerifyEmailSerializer,
)
from common.throttling import AuthLoginThrottle, AuthRegisterThrottle, PasswordResetThrottle


def _me_payload(user):
    # request.user is a SimpleLazyObject; resolve through the model class, not type(user).
    user = (
        get_user_model()
        .objects.select_related("preferences", "notification_preferences", "telegram_connection")
        .get(pk=user.pk)
    )
    return MeSerializer(user).data


@api_view(["GET"])
@permission_classes([AllowAny])
def csrf(request: Request) -> Response:
    return Response({"csrf_token": get_token(request._request)})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthRegisterThrottle])
def register(request: Request) -> Response:
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    user = services.register_user(
        email=data["email"],
        password=data["password"],
        full_name=data.get("full_name", ""),
        timezone_name=data.get("timezone", "UTC"),
    )
    services.login_user(request._request, email=data["email"], password=data["password"])
    return Response(_me_payload(user), status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([AuthLoginThrottle])
def login_view(request: Request) -> Response:
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = services.login_user(
        request._request, email=serializer.validated_data["email"], password=serializer.validated_data["password"]
    )
    return Response(_me_payload(user))


@api_view(["POST"])
@permission_classes([AllowAny])
def logout_view(request: Request) -> Response:
    services.logout_user(request._request)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def me(request: Request) -> Response:
    if request.method == "PATCH":
        serializer = ProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_profile(request.user, **serializer.validated_data)
    else:
        request.user.last_seen_at = timezone.now()
        request.user.save(update_fields=["last_seen_at"])
    return Response(_me_payload(request.user))


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def preferences(request: Request) -> Response:
    serializer = UserPreferenceSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    services.update_preferences(request.user, **serializer.validated_data)
    return Response(_me_payload(request.user))


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def notification_preferences(request: Request) -> Response:
    from apps.notifications.models import NotificationPreference

    prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
    serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(_me_payload(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def change_password(request: Request) -> Response:
    serializer = ChangePasswordSerializer(data=request.data, context={"user": request.user})
    serializer.is_valid(raise_exception=True)
    services.change_password(
        request.user,
        current_password=serializer.validated_data["current_password"],
        new_password=serializer.validated_data["new_password"],
    )
    # Keep the current session alive after the password change.
    from django.contrib.auth import update_session_auth_hash

    update_session_auth_hash(request._request, request.user)
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetThrottle])
def password_reset_request(request: Request) -> Response:
    serializer = PasswordResetRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.request_password_reset(serializer.validated_data["email"])
    return Response({"detail": "If that account exists, a reset link has been sent."})


@api_view(["POST"])
@permission_classes([AllowAny])
@throttle_classes([PasswordResetThrottle])
def password_reset_confirm(request: Request) -> Response:
    serializer = PasswordResetConfirmSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.reset_password(serializer.validated_data["token"], serializer.validated_data["password"])
    return Response({"detail": "Password updated. You can sign in now."})


@api_view(["POST"])
@permission_classes([AllowAny])
def verify_email(request: Request) -> Response:
    serializer = VerifyEmailSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = services.verify_email(serializer.validated_data["token"])
    return Response({"detail": "Email verified.", "email": user.email})


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([PasswordResetThrottle])
def resend_verification(request: Request) -> Response:
    services.send_verification_email(request.user)
    return Response({"detail": "Verification email sent."})


@api_view(["GET"])
@permission_classes([AllowAny])
def config(request: Request) -> Response:
    """Public, non-sensitive runtime config for the SPA."""
    return Response(
        {
            "require_email_verification": settings.REQUIRE_EMAIL_VERIFICATION,
            "telegram_bot_username": settings.TELEGRAM_BOT_USERNAME,
            # Server-level availability only; per-user access is `me.ai_enabled` (admins only).
            "ai_enabled": bool(settings.ANTHROPIC_API_KEY),
            "ai_admins_only": True,
            "site_url": settings.SITE_URL,
        }
    )
