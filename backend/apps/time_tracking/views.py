from __future__ import annotations

from datetime import date

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.time_tracking import services
from apps.time_tracking.models import SleepSession, TimeEntry
from apps.time_tracking.serializers import (
    ManualEntrySerializer,
    ManualSleepSerializer,
    SleepSessionSerializer,
    StartTimerSerializer,
    TimeEntrySerializer,
    UpdateEntrySerializer,
)
from common.actors import Actor
from common.pagination import StandardPagination
from common.tz import day_bounds, month_bounds, today_for, week_bounds

ENTRY_QS = TimeEntry.objects.select_related("task", "project", "routine_item")


def _entry(entry: TimeEntry) -> dict:
    return TimeEntrySerializer(ENTRY_QS.get(pk=entry.pk)).data


@api_view(["GET"])
def timer_state(request):
    running = services.running_entry(request.user)
    sleep = services.running_sleep(request.user)
    totals = services.today_totals(request.user)
    return Response(
        {
            "running": TimeEntrySerializer(running).data if running else None,
            "sleep": SleepSessionSerializer(sleep).data if sleep else None,
            "today": {"business": totals["business"], "personal": totals["personal"], "total": totals["total"]},
        }
    )


@api_view(["POST"])
def start_timer(request):
    serializer = StartTimerSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    entry = services.start_timer(Actor.from_request(request), **serializer.validated_data)
    return Response(_entry(entry), status=status.HTTP_201_CREATED)


@api_view(["POST"])
def stop_timer(request):
    entry = services.stop_timer(Actor.from_request(request), request.data.get("entry_id"))
    return Response(_entry(entry))


@api_view(["POST"])
def resume_timer(request, pk: int):
    entry = services.resume_timer(Actor.from_request(request), int(pk))
    return Response(_entry(entry), status=status.HTTP_201_CREATED)


@api_view(["GET", "POST"])
def entries(request):
    if request.method == "POST":
        serializer = ManualEntrySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        entry = services.add_manual_entry(Actor.from_request(request), **serializer.validated_data)
        return Response(_entry(entry), status=status.HTTP_201_CREATED)

    qs = ENTRY_QS.filter(owner=request.user)
    params = request.query_params
    if params.get("task"):
        qs = qs.filter(task_id=params["task"])
    if params.get("project"):
        qs = qs.filter(project_id=params["project"])
    if params.get("category") in ("business", "personal"):
        qs = qs.filter(category=params["category"])
    day = params.get("date")
    window = params.get("window")
    anchor = date.fromisoformat(day) if day else today_for(request.user)
    if window == "week":
        start, end, *_ = week_bounds(request.user, anchor)
        qs = qs.in_window(start, end)
    elif window == "month":
        start, end, *_ = month_bounds(request.user, anchor)
        qs = qs.in_window(start, end)
    elif day or window == "today":
        start, end = day_bounds(request.user, anchor)
        qs = qs.in_window(start, end)
    paginator = StandardPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(TimeEntrySerializer(page, many=True).data)


@api_view(["PATCH", "DELETE"])
def entry_detail(request, pk: int):
    actor = Actor.from_request(request)
    if request.method == "DELETE":
        services.delete_entry(actor, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = UpdateEntrySerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    entry = services.update_entry(actor, int(pk), **serializer.validated_data)
    return Response(_entry(entry))


@api_view(["GET"])
def totals(request):
    user = request.user
    window = request.query_params.get("window", "today")
    day_param = request.query_params.get("date")
    anchor = date.fromisoformat(day_param) if day_param else today_for(user)
    if window == "week":
        start, end, start_date, end_date = week_bounds(user, anchor)
    elif window == "month":
        start, end, start_date, end_date = month_bounds(user, anchor)
    else:
        start, end = day_bounds(user, anchor)
        start_date = end_date = anchor
    data = services.totals_for_window(user, start, end)
    data["sleep"] = services.sleep_seconds_for_window(user, start, end)
    data["start_date"] = start_date
    data["end_date"] = end_date
    data["by_project"] = [{"project_id": k, "seconds": v} for k, v in data["by_project"].items()]
    data["by_task"] = [{"task_id": k, "seconds": v} for k, v in data["by_task"].items()]
    data["by_routine_item"] = [{"routine_item_id": k, "seconds": v} for k, v in data["by_routine_item"].items()]
    return Response(data)


@api_view(["GET", "POST"])
def sleep(request):
    actor = Actor.from_request(request)
    if request.method == "POST":
        serializer = ManualSleepSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = services.add_manual_sleep(actor, **serializer.validated_data)
        return Response(SleepSessionSerializer(session).data, status=status.HTTP_201_CREATED)
    qs = SleepSession.objects.filter(owner=request.user)
    paginator = StandardPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(SleepSessionSerializer(page, many=True).data)


@api_view(["POST"])
def sleep_start(request):
    session = services.start_sleep(Actor.from_request(request))
    return Response(SleepSessionSerializer(session).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def sleep_stop(request):
    session = services.stop_sleep(Actor.from_request(request))
    return Response(SleepSessionSerializer(session).data)


@api_view(["DELETE"])
def sleep_detail(request, pk: int):
    services.delete_sleep(Actor.from_request(request), int(pk))
    return Response(status=status.HTTP_204_NO_CONTENT)
