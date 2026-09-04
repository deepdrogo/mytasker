from __future__ import annotations

from django.http import JsonResponse

from common.models import Source

_MOBILE_HINTS = ("Mobile", "Android", "iPhone", "iPad")

API_PREFIX = "/api/v1/"

# Assistant accounts only get the surface they need to add tasks for their principal. Everything
# else (routines, prompts, analytics, AI, sharing, Telegram, project management...) is refused at
# the edge so a forgotten permission check deeper down cannot leak the principal's data.
ASSISTANT_ALLOWED: tuple[tuple[str, frozenset[str] | None], ...] = (
    ("health/", None),
    ("auth/", None),
    ("tasks/", None),
    ("projects/", frozenset({"GET", "HEAD", "OPTIONS"})),
    ("timer/", None),
    ("translations/", None),
    ("notifications/", None),
    ("search/", None),
)


ASSISTANT_SCOPE_MESSAGE = "Not available for assistant accounts."


def assistant_may_call(path: str, method: str) -> bool:
    if not path.startswith(API_PREFIX):
        return True
    rel_path = path[len(API_PREFIX) :]
    for prefix, methods in ASSISTANT_ALLOWED:
        if rel_path.startswith(prefix):
            return methods is None or method in methods
    return False


def _is_assistant(user) -> bool:
    return user is not None and user.is_authenticated and getattr(user, "assistant_for_id", None) is not None


class AssistantScopeMiddleware:
    """Refuse API calls outside the assistant allowlist. Must run after AuthenticationMiddleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(API_PREFIX):
            user = getattr(request, "user", None)
            if _is_assistant(user) and not assistant_may_call(request.path, request.method):
                return JsonResponse({"detail": ASSISTANT_SCOPE_MESSAGE, "code": "assistant_scope"}, status=403)
        return self.get_response(request)


class AssistantScopePermission:
    """
    DRF twin of the middleware, applied via DEFAULT_PERMISSION_CLASSES so authentication performed
    by DRF itself (tests with force_authenticate, future token auth) gets the same fence.
    """

    message = ASSISTANT_SCOPE_MESSAGE

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        return not _is_assistant(request.user) or assistant_may_call(request.path, request.method)

    def has_object_permission(self, request, view, obj) -> bool:
        return True


class RequestSourceMiddleware:
    """
    Attach `request.client_source` (web / mobile_web) so services can record the completion source.
    The frontend may override with the `X-Client-Source` header (e.g. "mobile_web").
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        header = request.headers.get("X-Client-Source", "").strip()
        if header in {Source.WEB, Source.MOBILE_WEB}:
            request.client_source = header
        else:
            ua = request.headers.get("User-Agent", "")
            request.client_source = Source.MOBILE_WEB if any(h in ua for h in _MOBILE_HINTS) else Source.WEB
        return self.get_response(request)
