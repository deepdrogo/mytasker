from django.core.cache import cache
from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def health(request):
    checks = {"db": False, "cache": False}
    try:
        with connection.cursor() as cur:
            cur.execute("SELECT 1")
        checks["db"] = True
    except Exception:  # pragma: no cover
        pass
    try:
        cache.set("health", "ok", 5)
        checks["cache"] = cache.get("health") == "ok"
    except Exception:  # pragma: no cover
        pass
    ok = all(checks.values())
    return JsonResponse({"status": "ok" if ok else "degraded", "checks": checks}, status=200 if ok else 503)
