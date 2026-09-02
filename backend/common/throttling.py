from rest_framework.throttling import AnonRateThrottle, ScopedRateThrottle, UserRateThrottle


class ScopedThrottle(ScopedRateThrottle):
    """Use `throttle_scope = "..."` on a view; rates come from settings."""


class AuthLoginThrottle(AnonRateThrottle):
    scope = "auth_login"


class AuthRegisterThrottle(AnonRateThrottle):
    scope = "auth_register"


class PasswordResetThrottle(AnonRateThrottle):
    scope = "auth_password_reset"


class SharePasswordThrottle(AnonRateThrottle):
    scope = "share_password"


class ShareGuestThrottle(AnonRateThrottle):
    scope = "share_guest"


class AICommandThrottle(UserRateThrottle):
    scope = "ai_command"


class AIHeavyThrottle(UserRateThrottle):
    scope = "ai_heavy"


class SearchThrottle(UserRateThrottle):
    scope = "search"
