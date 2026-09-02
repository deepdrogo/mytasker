from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.collab import services
from apps.collab.models import ActivityEvent, Comment
from apps.collab.serializers import ActivitySerializer, CommentInputSerializer, CommentSerializer
from common.actors import Actor
from common.exceptions import ValidationFailed
from common.pagination import ActivityCursorPagination


@api_view(["GET", "POST"])
def comments(request):
    if request.method == "POST":
        serializer = CommentInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = services.create_comment(Actor.from_request(request), **serializer.validated_data)
        comment = Comment.objects.select_related("author", "task__project", "project").get(pk=comment.pk)
        return Response(CommentSerializer(comment, context={"request": request}).data, status=status.HTTP_201_CREATED)

    params = request.query_params
    qs = Comment.objects.visible_to(request.user).select_related("author", "task__project", "project")
    if params.get("task"):
        qs = qs.filter(task_id=params["task"])
    elif params.get("project"):
        qs = qs.filter(project_id=params["project"])
    else:
        raise ValidationFailed("Provide a task or project filter.")
    return Response(CommentSerializer(qs[:500], many=True, context={"request": request}).data)


@api_view(["PATCH", "DELETE"])
def comment_detail(request, pk: int):
    actor = Actor.from_request(request)
    if request.method == "DELETE":
        services.delete_comment(actor, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    body = str(request.data.get("body", ""))
    comment = services.update_comment(actor, int(pk), body=body)
    comment = Comment.objects.select_related("author", "task__project", "project").get(pk=comment.pk)
    return Response(CommentSerializer(comment, context={"request": request}).data)


@api_view(["GET"])
def activity(request):
    """
    Activity feed with cursor pagination.
    ?project=ID   -> project feed
    ?task=ID      -> a single task's history
    (no filter)   -> everything visible to the user
    """
    params = request.query_params
    qs = ActivityEvent.objects.visible_to(request.user).feed().select_related("project")
    if params.get("project"):
        qs = qs.filter(project_id=params["project"])
    if params.get("task"):
        qs = qs.filter(target_type="task", target_id=params["task"])
    if params.get("name"):
        qs = qs.filter(name__in=[n for n in params["name"].split(",") if n])
    paginator = ActivityCursorPagination()
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(ActivitySerializer(page, many=True).data)
