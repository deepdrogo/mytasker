"""Session-based authentication for WebSocket connections.

`AuthMiddlewareStack` already wraps CookieMiddleware + SessionMiddleware + AuthMiddleware,
which is exactly what we need since the SPA authenticates with the Django session cookie.
"""

from channels.auth import AuthMiddlewareStack


def SessionAuthMiddlewareStack(inner):  # noqa: N802 - channels naming convention
    return AuthMiddlewareStack(inner)
