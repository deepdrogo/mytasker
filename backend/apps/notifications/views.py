from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.notifications import services
from apps.notifications.models import Notification
from apps.notifications.serializers import (
    MarkReadSerializer,
    NotificationPreferenceSerializer,
    NotificationSerializer,
)
from common.pagination import StandardPagination


@api_view(["GET"])
def notifications(request):
    qs = Notification.objects.filter(user=request.user)
    if request.query_params.get("unread") in ("1", "true"):
        qs = qs.filter(read_at__isnull=True)
    if request.query_params.get("category"):
        qs = qs.filter(category=request.query_params["category"])
    paginator = StandardPagination()
    page = paginator.paginate_queryset(qs, request)
    response = paginator.get_paginated_response(NotificationSerializer(page, many=True).data)
    response.data["unread"] = services.unread_count(request.user.pk)
    return response


@api_view(["GET"])
def unread(request):
    return Response({"unread": services.unread_count(request.user.pk)})


@api_view(["POST"])
def mark_read(request):
    serializer = MarkReadSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    updated = services.mark_read(request.user, serializer.validated_data.get("ids"))
    return Response({"updated": updated, "unread": services.unread_count(request.user.pk)})


@api_view(["DELETE"])
def clear(request):
    deleted, _ = Notification.objects.filter(user=request.user, read_at__isnull=False).delete()
    return Response({"deleted": deleted}, status=status.HTTP_200_OK)


@api_view(["GET", "PATCH"])
def preferences(request):
    prefs = services.preferences_for(request.user)
    if request.method == "PATCH":
        serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
    return Response(NotificationPreferenceSerializer(prefs).data)
