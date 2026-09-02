"""
Who may use the AI assistant.

Product rule: AI is an administrators-only capability. "Administrator" means a staff account
(`is_staff`), i.e. the same people who can open Django admin. Every AI entry point (REST views,
Telegram natural-language routing, inline callbacks) must go through `ai_allowed`.
"""

from __future__ import annotations

from rest_framework.permissions import BasePermission

from apps.ai.provider import is_configured


def ai_allowed(user) -> bool:
    """True when this user may invoke the assistant at all (regardless of provider configuration)."""
    return bool(user is not None and getattr(user, "is_authenticated", False) and user.is_active and user.is_staff)


def ai_enabled_for(user) -> bool:
    """True when the assistant is both configured on the server and permitted for this user."""
    return ai_allowed(user) and is_configured()


class IsAIUser(BasePermission):
    """DRF permission: authenticated staff accounts only. Non-staff get 403, anonymous 401."""

    message = "The AI assistant is available to administrators only."
    code = "ai_admins_only"

    def has_permission(self, request, view) -> bool:
        return ai_allowed(request.user)
