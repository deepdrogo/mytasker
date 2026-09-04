from __future__ import annotations

from datetime import date

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.routines import services
from apps.routines.models import Routine, RoutineItem, Rule
from apps.routines.serializers import (
    CompletionSerializer,
    ReorderSerializer,
    RoutineItemInputSerializer,
    RoutineItemSerializer,
    RuleInputSerializer,
    RuleKeptSerializer,
    RuleSerializer,
)
from apps.time_tracking.services import tracked_seconds_by_routine_item
from common.exceptions import ValidationFailed
from common.tz import today_for


def _context(user, day: date | None = None) -> dict:
    day = day or today_for(user)
    return {
        "completions": services.completions_for_day(user, day),
        "tracked": tracked_seconds_by_routine_item(user, day),
    }


def _parse_day(request) -> date | None:
    raw = request.query_params.get("date")
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise ValidationFailed("Invalid date.") from exc


@api_view(["GET", "POST"])
def routine_items(request, kind: str):
    if kind not in dict(Routine.Kind.choices):
        raise ValidationFailed("Unknown routine kind.")
    user = request.user
    if request.method == "POST":
        serializer = RoutineItemInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = services.create_item(user, kind, **serializer.validated_data)
        return Response(RoutineItemSerializer(item, context=_context(user)).data, status=status.HTTP_201_CREATED)

    day = _parse_day(request)
    only_today = request.query_params.get("today") in ("1", "true")
    if only_today:
        items = services.items_for_day(user, kind, day)
    else:
        items = list(RoutineItem.objects.filter(routine__owner=user, routine__kind=kind).select_related("routine"))
    current = services.current_item(user, kind)
    return Response(
        {
            "items": RoutineItemSerializer(items, many=True, context=_context(user, day)).data,
            "current_item_id": current.pk if current else None,
        }
    )


@api_view(["PATCH", "DELETE"])
def routine_item_detail(request, pk: int):
    user = request.user
    if request.method == "DELETE":
        services.delete_item(user, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = RoutineItemInputSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    item = services.update_item(user, int(pk), **serializer.validated_data)
    return Response(RoutineItemSerializer(item, context=_context(user)).data)


@api_view(["POST"])
def routine_item_complete(request, pk: int):
    serializer = CompletionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    services.set_completion(
        request.user,
        int(pk),
        completed=data["completed"],
        day=data.get("date"),
        manual_minutes=data.get("manual_minutes"),
    )
    item = RoutineItem.objects.select_related("routine").get(pk=pk)
    return Response(RoutineItemSerializer(item, context=_context(request.user, data.get("date"))).data)


@api_view(["POST"])
def routine_reorder(request, kind: str):
    serializer = ReorderSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.reorder_items(request.user, kind, serializer.validated_data["ids"])
    return Response(status=status.HTTP_204_NO_CONTENT)


def _rule_context(user, day: date | None = None) -> dict:
    return {
        "rule_completions": services.rule_completions_for_day(user, day),
        "rule_streaks": services.rule_streaks(user, day),
    }


@api_view(["GET", "POST"])
def rules(request):
    if request.method == "POST":
        serializer = RuleInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = services.create_rule(request.user, **serializer.validated_data)
        return Response(
            RuleSerializer(rule, context=_rule_context(request.user)).data, status=status.HTTP_201_CREATED
        )
    day = _parse_day(request)
    return Response(
        RuleSerializer(
            Rule.objects.filter(owner=request.user), many=True, context=_rule_context(request.user, day)
        ).data
    )


@api_view(["PATCH", "DELETE"])
def rule_detail(request, pk: int):
    if request.method == "DELETE":
        services.delete_rule(request.user, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = RuleInputSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    rule = services.update_rule(request.user, int(pk), **serializer.validated_data)
    return Response(RuleSerializer(rule, context=_rule_context(request.user)).data)


@api_view(["POST"])
def rule_kept(request, pk: int):
    """Daily check: kept (true) / broken (false) / clear (null)."""
    serializer = RuleKeptSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    services.set_rule_kept(request.user, int(pk), kept=data["kept"], day=data.get("date"))
    rule = Rule.objects.get(pk=pk, owner=request.user)
    return Response(RuleSerializer(rule, context=_rule_context(request.user, data.get("date"))).data)


@api_view(["POST"])
def rules_reorder(request):
    serializer = ReorderSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    services.reorder_rules(request.user, serializer.validated_data["ids"])
    return Response(status=status.HTTP_204_NO_CONTENT)
