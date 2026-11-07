"""
SecurityShieldMiddleware - first thing every API/admin request meets.

Request side:  banned address -> 403; hacker tool, scanner path or attack payload -> refused and scored;
               scripted writes without our Origin -> refused and scored.
Response side: 403 / 404 / 429 bursts (object-id enumeration, endpoint guessing) are scored too.
"""

from __future__ import annotations

from urllib.parse import urlsplit

from django.conf import settings
from django.http import JsonResponse

from apps.security import blocklist, detectors, guard
from apps.security.ip import client_ip, is_trusted
from apps.security.models import SecurityEvent

Kind = SecurityEvent.Kind
Severity = SecurityEvent.Severity

UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# Requests that legitimately come without a browser Origin.
ORIGIN_EXEMPT = ("/api/v1/telegram/webhook/",)
# Response codes worth points, by whether the caller is signed in (guessing ids while signed in is the IDOR tell).
STATUS_POINTS = {403: 6, 404: 4, 405: 3, 429: 10}
ANON_STATUS_POINTS = {401: 2, 403: 6, 404: 6, 405: 4, 429: 10}
EMAIL_ORACLES = ("/api/v1/auth/assistants/linked/",)


def _deny(status: int, code: str, message: str) -> JsonResponse:
    response = JsonResponse({"error": {"code": code, "message": message}}, status=status)
    response["Cache-Control"] = "no-store"
    return response


def _site_origin() -> str:
    parts = urlsplit(settings.SITE_URL)
    return f"{parts.scheme}://{parts.netloc}"


class SecurityShieldMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not getattr(settings, "SECURITY_SHIELD_ENABLED", True):
            return self.get_response(request)
        path = request.path
        if not (path.startswith("/api/") or path.startswith("/admin")):
            return self.get_response(request)
        token = guard.current_request.set(request)
        try:
            return self._guarded(request, path)
        finally:
            guard.current_request.reset(token)

    def _guarded(self, request, path):
        ip = client_ip(request)
        if ip is None or is_trusted(ip):
            return self.get_response(request)

        network = blocklist.find(ip)
        if network:
            blocklist.note_hit(network)
            return _deny(403, "blocked", "Access denied.")

        if path.startswith(detectors.TRAP_PATH):
            original = request.META.get("HTTP_X_TRAP_URI", "")[:300] or path
            guard.flag(
                request,
                kind=Kind.TRAP,
                points=100,
                severity=Severity.HIGH,
                path=original,
                details={"uri": original},
                ban_source="trap",
            )
            return _deny(404, "not_found", "Not found.")

        verdict = detectors.inspect(
            request.method, path, request.META.get("QUERY_STRING", ""), request.META.get("HTTP_USER_AGENT", "")
        )
        if verdict is not None:
            guard.flag(
                request,
                kind=verdict.kind,
                points=verdict.points,
                severity=verdict.severity,
                details=verdict.details,
                ban_source="trap" if verdict.kind == Kind.TRAP else "auto",
            )
            if verdict.reject:
                return _deny(
                    verdict.status,
                    "forbidden" if verdict.status == 403 else "not_found",
                    "Forbidden." if verdict.status == 403 else "Not found.",
                )

        if (
            request.method in UNSAFE_METHODS
            and path.startswith("/api/")
            and not path.startswith(ORIGIN_EXEMPT)
            and getattr(settings, "SECURITY_REQUIRE_ORIGIN", True)
            and not self._same_origin(request)
        ):
            guard.flag(
                request,
                kind=Kind.ORIGIN,
                points=30,
                severity=Severity.MEDIUM,
                details={
                    "origin": request.META.get("HTTP_ORIGIN", "")[:100],
                    "referer": request.META.get("HTTP_REFERER", "")[:100],
                },
            )
            return _deny(403, "forbidden", "Forbidden.")

        response = self.get_response(request)
        self._score_response(request, response)
        return response

    @staticmethod
    def _same_origin(request) -> bool:
        site = _site_origin()
        origin = request.META.get("HTTP_ORIGIN", "")
        if origin:
            return origin == site
        referer = request.META.get("HTTP_REFERER", "")
        return referer == site or referer.startswith(f"{site}/")

    @staticmethod
    def _score_response(request, response) -> None:
        status = response.status_code
        if status < 400 or not request.path.startswith("/api/"):
            return
        user = getattr(request, "user", None)
        signed_in = bool(user is not None and user.is_authenticated)
        points = (STATUS_POINTS if signed_in else ANON_STATUS_POINTS).get(status, 0)
        unique = status != 429
        if request.method == "POST" and status == 400 and request.path.startswith(EMAIL_ORACLES):
            points, unique = 12, False  # "no account with that e-mail": every guess is a new probe
        if request.path.startswith("/api/v1/auth/me/") and status == 401:
            points = 0  # the SPA asks this on every cold start
        if not points:
            return
        kind = Kind.RATE_LIMITED if status == 429 else Kind.ENUMERATION
        guard.flag(
            request, kind=kind, points=points, severity=Severity.LOW, details={"status": status}, unique_path=unique
        )
