from __future__ import annotations

from django.db.models import Count
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.decorators import api_view, authentication_classes, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.sharing import services
from apps.sharing.models import ShareLink
from apps.sharing.serializers import (
    GuestTaskSerializer,
    ShareCreateSerializer,
    ShareLinkSerializer,
    ShareUpdateSerializer,
)
from common.actors import Actor
from common.throttling import ShareGuestThrottle, SharePasswordThrottle

GUEST_HEADER = "HTTP_X_SHARE_SESSION"


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """Guest endpoints are anonymous and keyed by a bearer-like session header; CSRF does not apply."""

    def enforce_csrf(self, request):
        return None


# ------------------------------------------------------------------ owner API


@api_view(["GET", "POST"])
def shares(request):
    actor = Actor.from_request(request)
    if request.method == "POST":
        serializer = ShareCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        share, token = services.create_share(actor, **serializer.validated_data)
        share = ShareLink.objects.annotate(task_count=Count("items")).get(pk=share.pk)
        return Response(ShareLinkSerializer(share, context={"token": token}).data, status=status.HTTP_201_CREATED)

    qs = ShareLink.objects.filter(owner=request.user).annotate(task_count=Count("items"))
    if request.query_params.get("task"):
        qs = qs.filter(items__task_id=request.query_params["task"]).distinct()
    if request.query_params.get("active") in ("1", "true"):
        qs = [s for s in qs if s.is_active]
    return Response(ShareLinkSerializer(qs, many=True).data)


@api_view(["GET", "PATCH", "DELETE"])
def share_detail(request, pk: int):
    actor = Actor.from_request(request)
    if request.method == "DELETE":
        services.delete_share(actor, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    if request.method == "PATCH":
        serializer = ShareUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        services.update_share(actor, int(pk), **serializer.validated_data)
    share = ShareLink.objects.filter(pk=pk, owner=request.user).annotate(task_count=Count("items")).first()
    if share is None:
        from common.exceptions import NotFound

        raise NotFound("Share link not found.")
    return Response(ShareLinkSerializer(share).data)


@api_view(["POST"])
def share_revoke(request, pk: int):
    share = services.revoke_share(Actor.from_request(request), int(pk))
    share = ShareLink.objects.annotate(task_count=Count("items")).get(pk=share.pk)
    return Response(ShareLinkSerializer(share).data)


# ------------------------------------------------------------------ guest API


def _guest_payload(share: ShareLink, session, *, tasks=None, subtasks=None) -> dict:
    data = {
        "title": share.title,
        "requires_password": share.requires_password,
        "ask_guest_name": share.ask_guest_name,
        "allow_complete": share.allow_complete,
        "allow_reopen": share.allow_reopen,
        "guest_name": session.guest_name if session else None,
        "authenticated": session is not None or not share.requires_password,
        "expires_at": share.expires_at,
        "tasks": [],
    }
    if session is not None or not share.requires_password:
        if tasks is None:
            tasks, subtasks = services.shared_tasks(share)
        grouped: dict[int, list] = {}
        for sub in subtasks or []:
            grouped.setdefault(sub.parent_id, []).append(sub)
        data["tasks"] = GuestTaskSerializer(tasks, many=True, context={"subtasks": grouped}).data
    return data


def _session_from(request, share):
    return services.resolve_session(share, request.META.get(GUEST_HEADER))


@api_view(["GET"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([ShareGuestThrottle])
def guest_view(request, token: str):
    share = services.resolve_share(token, request.META.get(GUEST_HEADER))
    session, new_token = services.open_share(share, request, session_token=request.META.get(GUEST_HEADER))
    payload = _guest_payload(share, session)
    if new_token:
        payload["session_token"] = new_token
    return Response(payload)


@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([SharePasswordThrottle])
def guest_unlock(request, token: str):
    share = services.resolve_share(token, request.META.get(GUEST_HEADER))
    session, session_token = services.unlock_share(share, request, password=str(request.data.get("password", "")))
    payload = _guest_payload(share, session)
    payload["session_token"] = session_token
    return Response(payload)


@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([ShareGuestThrottle])
def guest_identify(request, token: str):
    share = services.resolve_share(token, request.META.get(GUEST_HEADER))
    session = _session_from(request, share)
    if session is None:
        from common.exceptions import Forbidden

        raise Forbidden("Unlock the link first.", code="share_locked")
    services.identify_guest(share, session, name=str(request.data.get("name", "")))
    return Response(_guest_payload(share, session))


@api_view(["POST"])
@authentication_classes([CsrfExemptSessionAuthentication])
@permission_classes([AllowAny])
@throttle_classes([ShareGuestThrottle])
def guest_task_action(request, token: str, task_id: int, action: str):
    share = services.resolve_share(token, request.META.get(GUEST_HEADER))
    session = _session_from(request, share)
    if session is None:
        from common.exceptions import Forbidden

        raise Forbidden("Unlock the link first.", code="share_locked")
    if action == "complete":
        services.guest_complete(share, session, int(task_id))
    elif action == "reopen":
        services.guest_reopen(share, session, int(task_id))
    else:
        from common.exceptions import NotFound

        raise NotFound("Unknown action.")
    return Response(_guest_payload(share, session))
