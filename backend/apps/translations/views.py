from __future__ import annotations

from rest_framework import serializers
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.translations import services


class LookupSerializer(serializers.Serializer):
    keys = serializers.ListField(
        child=serializers.RegexField(r"^[a-z_]{1,30}:\d{1,18}$"),
        min_length=1,
        max_length=services.MAX_LOOKUP_KEYS,
    )


class TranslationsThrottle(ScopedRateThrottle):
    scope = "translations"


@api_view(["POST"])
@throttle_classes([TranslationsThrottle])
def lookup(request):
    """
    Body: {"keys": ["task:12", "project:3"]}
    Response: {"items": {"task:12": {"status": "ready", "source_lang": "ka", "translations": {"en": {...}}}, ...}}
    Keys the user may not see are simply absent. Missing translations are queued as a side effect.
    """
    serializer = LookupSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    items = services.lookup(request.user, serializer.validated_data["keys"])
    return Response({"items": items, "enabled": services.enabled()})


@api_view(["POST"])
@throttle_classes([TranslationsThrottle])
def retry(request):
    """Force a fresh translation of one object: {"key": "task:12"}."""
    key = str(request.data.get("key") or "")
    target_type, _, raw_id = key.partition(":")
    if not raw_id.isdigit():
        return Response({"detail": "Invalid key."}, status=400)
    spec = services.get_spec(target_type)
    if spec is None or not spec.visible_queryset(request.user).filter(pk=int(raw_id)).exists():
        return Response({"detail": "Not found."}, status=404)
    row = services.request_translation(target_type, int(raw_id), force=True)
    return Response({"status": row.status if row else "none"})
