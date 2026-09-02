from __future__ import annotations

from datetime import date

from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.analytics import services
from apps.analytics.today import today_snapshot
from common.exceptions import ValidationFailed
from common.tz import today_for


def _anchor(request) -> date | None:
    raw = request.query_params.get("date")
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValidationFailed("Invalid date.") from exc


@api_view(["GET"])
def today(request):
    return Response(today_snapshot(request.user, request))


@api_view(["GET"])
def daily(request):
    return Response(services.daily_review(request.user, _anchor(request)))


@api_view(["GET"])
def weekly(request):
    return Response(services.weekly_review(request.user, _anchor(request)))


@api_view(["GET"])
def monthly(request):
    return Response(services.monthly_review(request.user, _anchor(request)))


@api_view(["POST"])
def recompute(request):
    """Force a rebuild of a past day's summary (e.g. after editing time entries)."""
    day = _anchor(request) or today_for(request.user)
    return Response(services.summary_for(request.user, day, refresh=True).as_dict())
