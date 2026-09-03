from __future__ import annotations

from django.db.models import Prefetch
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.tasks import selectors, services
from apps.tasks.filters import TaskFilter
from apps.tasks.models import Task
from apps.tasks.serializers import (
    BulkRescheduleSerializer,
    TaskCreateSerializer,
    TaskSerializer,
    TaskUpdateSerializer,
    TaskWithSubtasksSerializer,
)
from common.actors import Actor


class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    filterset_class = TaskFilter
    ordering_map = {
        "due": ["due_at", "id"],
        "created": ["created_at"],
        "updated": ["updated_at"],
        "priority": ["priority_rank", "due_at"],
        "title": ["title"],
        "completed": ["completed_at"],
        "manual": ["sort_order", "-created_at"],
    }
    ordering = ["manual"]

    def get_queryset(self):
        qs = selectors.base_queryset(self.request.user).annotate(priority_rank=selectors.priority_rank_expression())
        if self.action == "list" and self.request.query_params.get("include_subtasks") == "1":
            qs = qs.prefetch_related(
                Prefetch(
                    "subtasks",
                    queryset=Task.objects.filter(deleted_at__isnull=True)
                    .select_related("assignee", "owner", "project")
                    .order_by("sort_order", "id"),
                    to_attr="prefetched_subtasks",
                )
            )
        return qs

    def get_serializer_class(self):
        if self.action == "retrieve" or self.request.query_params.get("include_subtasks") == "1":
            return TaskWithSubtasksSerializer
        return TaskSerializer

    def _actor(self) -> Actor:
        return Actor.from_request(self.request)

    def _respond(self, task: Task, code: int = status.HTTP_200_OK) -> Response:
        fresh = self.get_queryset().filter(pk=task.pk).first() or task
        return Response(TaskWithSubtasksSerializer(fresh, context=self.get_serializer_context()).data, status=code)

    def create(self, request, *args, **kwargs):
        serializer = TaskCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = services.create_task(self._actor(), **serializer.validated_data)
        return self._respond(task, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        serializer = TaskUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_version = data.pop("version", None)
        task = services.update_task(self._actor(), int(kwargs["pk"]), expected_version=expected_version, **data)
        return self._respond(task)

    def destroy(self, request, *args, **kwargs):
        services.delete_task(self._actor(), int(kwargs["pk"]))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def complete(self, request, pk=None):
        task = services.complete_task(self._actor(), int(pk))
        return self._respond(task)

    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        task = services.reopen_task(self._actor(), int(pk))
        return self._respond(task)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        task = services.duplicate_task(self._actor(), int(pk))
        return self._respond(task, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def snooze(self, request, pk=None):
        minutes = int(request.data.get("minutes", 60))
        task = services.snooze(self._actor(), int(pk), minutes=max(1, min(minutes, 60 * 24 * 30)))
        return self._respond(task)

    @action(detail=True, methods=["get", "post"], url_path="subtasks")
    def subtasks(self, request, pk=None):
        if request.method == "POST":
            serializer = TaskCreateSerializer(data={**request.data, "parent_id": int(pk)})
            serializer.is_valid(raise_exception=True)
            task = services.create_task(self._actor(), **serializer.validated_data)
            return Response(
                TaskSerializer(task, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED
            )
        items = self.get_queryset().filter(parent_id=int(pk)).order_by("sort_order", "id")
        return Response(TaskSerializer(items, many=True, context=self.get_serializer_context()).data)

    @action(detail=False, methods=["post"], url_path="bulk-reschedule")
    def bulk_reschedule(self, request):
        """Same deadline for many tasks at once (``due_at: null`` clears it)."""
        serializer = BulkRescheduleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        result = services.bulk_reschedule(
            self._actor(), data["task_ids"], due_at=data["due_at"], due_has_time=data["due_has_time"]
        )
        return Response(result)

    @action(detail=False, methods=["get"])
    def counts(self, request):
        """Sidebar/tab counters in a single query per bucket."""
        from django.db.models import Count, Q
        from django.utils import timezone

        from common.tz import day_bounds

        _, end_of_today = day_bounds(request.user)
        now = timezone.now()
        base = selectors.base_queryset(request.user).top_level()
        data = base.aggregate(
            personal=Count("id", filter=Q(kind=Task.Kind.PERSONAL) & ~Q(status__in=["done", "cancelled"])),
            business=Count(
                "id",
                filter=Q(kind=Task.Kind.BUSINESS, origin=Task.Origin.LIST) & ~Q(status__in=["done", "cancelled"]),
            ),
            today=Count("id", filter=Q(due_at__lt=end_of_today) & ~Q(status__in=["done", "cancelled"])),
            overdue=Count("id", filter=Q(due_at__lt=now) & ~Q(status__in=["done", "cancelled"])),
            upcoming=Count("id", filter=Q(due_at__gte=end_of_today) & ~Q(status__in=["done", "cancelled"])),
        )
        return Response(data)
