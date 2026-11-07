from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle

from apps.security.ip import client_ip


class RealIPMixin:
    """
    DRF's default ident is the whole X-Forwarded-For header, which the client controls - rotate it and every
    limit resets. Throttle on the address nginx restored from Cloudflare instead.
    """

    def get_ident(self, request):
        return client_ip(request) or super().get_ident(request)


class ScopedThrottle(RealIPMixin, ScopedRateThrottle):
    """Use `throttle_scope = "..."` on a view; rates come from settings."""


class GlobalAnonThrottle(RealIPMixin, AnonRateThrottle):
    scope = "anon"


class GlobalUserThrottle(RealIPMixin, UserRateThrottle):
    scope = "user"


class AuthLoginThrottle(RealIPMixin, AnonRateThrottle):
    scope = "auth_login"


class AuthRegisterThrottle(RealIPMixin, AnonRateThrottle):
    scope = "auth_register"


class PasswordResetThrottle(RealIPMixin, AnonRateThrottle):
    scope = "auth_password_reset"


class SharePasswordThrottle(RealIPMixin, AnonRateThrottle):
    scope = "share_password"


class ShareGuestThrottle(RealIPMixin, AnonRateThrottle):
    scope = "share_guest"


class AICommandThrottle(RealIPMixin, UserRateThrottle):
    scope = "ai_command"


class AIHeavyThrottle(RealIPMixin, UserRateThrottle):
    scope = "ai_heavy"


class SearchThrottle(RealIPMixin, UserRateThrottle):
    scope = "search"


class WriteOnlyUserThrottle(RealIPMixin, UserRateThrottle):
    """Counts only writes, so the GET half of a GET/POST action stays unlimited."""

    def allow_request(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return super().allow_request(request, view)


class FindLogoThrottle(RealIPMixin, UserRateThrottle):
    scope = "find_logo"


class MemberInviteThrottle(WriteOnlyUserThrottle):
    scope = "member_invite"


class AssistantLinkThrottle(WriteOnlyUserThrottle):
    scope = "assistant_link"
