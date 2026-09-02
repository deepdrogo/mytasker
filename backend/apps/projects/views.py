from __future__ import annotations

import django_filters as filters
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view
from rest_framework.response import Response

from apps.projects import selectors, services
from apps.projects.models import Idea, Project, ProjectMembership
from apps.projects.serializers import (
    IdeaInputSerializer,
    IdeaSerializer,
    InviteSerializer,
    MembershipSerializer,
    ModeChangeSerializer,
    ProjectCreateSerializer,
    ProjectSerializer,
    ProjectUpdateSerializer,
    RoleSerializer,
)
from common.actors import Actor
from common.permissions import Capability


class ProjectFilter(filters.FilterSet):
    kind = filters.CharFilter(field_name="kind")
    mode = filters.CharFilter(field_name="mode")
    status = filters.BaseInFilter(field_name="status")
    priority = filters.BaseInFilter(field_name="priority")
    view = filters.CharFilter(method="filter_view")
    q = filters.CharFilter(method="filter_q")
    owned = filters.BooleanFilter(method="filter_owned")

    class Meta:
        model = Project
        fields: list[str] = []

    def filter_view(self, queryset, name, value):
        if value == "active":
            return queryset.filter(kind=Project.Kind.ACTIVE).exclude(
                status__in=[Project.Status.ARCHIVED, Project.Status.COMPLETED]
            )
        if value == "open":
            return queryset.exclude(status__in=[Project.Status.ARCHIVED, Project.Status.COMPLETED])
        if value == "archived":
            return queryset.filter(status__in=[Project.Status.ARCHIVED, Project.Status.COMPLETED])
        if value == "team":
            return queryset.filter(mode__in=[Project.Mode.GROUP, Project.Mode.GROUP_PLUS])
        return queryset

    def filter_q(self, queryset, name, value):
        return queryset.filter(name__icontains=value)

    def filter_owned(self, queryset, name, value):
        return queryset.filter(owner=self.request.user) if value else queryset.exclude(owner=self.request.user)


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    filterset_class = ProjectFilter
    ordering_map = {
        "manual": ["sort_order", "-created_at"],
        "name": ["name"],
        "deadline": ["deadline", "id"],
        "updated": ["updated_at"],
        "created": ["created_at"],
        "progress": ["task_done"],
    }
    ordering = ["manual"]

    def get_queryset(self):
        return selectors.base_queryset(self.request.user)

    def _actor(self) -> Actor:
        return Actor.from_request(self.request)

    def _respond(self, project: Project, code: int = status.HTTP_200_OK) -> Response:
        fresh = self.get_queryset().filter(pk=project.pk).first() or project
        return Response(ProjectSerializer(fresh, context=self.get_serializer_context()).data, status=code)

    def create(self, request, *args, **kwargs):
        serializer = ProjectCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = services.create_project(self._actor(), **serializer.validated_data)
        return self._respond(project, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        serializer = ProjectUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_version = data.pop("version", None)
        project = services.update_project(self._actor(), int(kwargs["pk"]), expected_version=expected_version, **data)
        return self._respond(project)

    def destroy(self, request, *args, **kwargs):
        services.delete_project(self._actor(), int(kwargs["pk"]))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def mode(self, request, pk=None):
        serializer = ModeChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        project = services.change_mode(self._actor(), int(pk), mode=serializer.validated_data["mode"])
        return self._respond(project)

    @action(detail=True, methods=["get", "post"])
    def members(self, request, pk=None):
        project = services.get_project_for_user(int(pk), request.user)
        if request.method == "POST":
            serializer = InviteSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            membership, token = services.invite_member(self._actor(), project.pk, **serializer.validated_data)
            payload = MembershipSerializer(membership).data
            # The invite link is returned to the inviter so it works even without SMTP.
            payload["invite_url"] = f"{request.build_absolute_uri('/')[:-1]}/projects/join?token={token}"
            return Response(payload, status=status.HTTP_201_CREATED)
        members = ProjectMembership.objects.filter(project=project).select_related("user").order_by("role", "id")
        return Response(MembershipSerializer(members, many=True).data)

    @action(detail=True, methods=["patch", "delete"], url_path=r"members/(?P<membership_id>\d+)")
    def member(self, request, pk=None, membership_id=None):
        if request.method == "DELETE":
            services.remove_member(self._actor(), int(pk), int(membership_id))
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = RoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        membership = services.change_role(
            self._actor(), int(pk), int(membership_id), role=serializer.validated_data["role"]
        )
        return Response(MembershipSerializer(membership).data)

    @action(detail=True, methods=["post"])
    def leave(self, request, pk=None):
        project = services.get_project_for_user(int(pk), request.user)
        membership = ProjectMembership.objects.filter(project=project, user=request.user).first()
        if membership is None:
            return Response(status=status.HTTP_204_NO_CONTENT)
        services.remove_member(self._actor(), project.pk, membership.pk)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["get"])
    def overview(self, request, pk=None):
        """Aggregated numbers for the project Overview tab."""
        from django.db.models import Count, Q, Sum
        from django.utils import timezone

        from apps.tasks import selectors as task_selectors
        from apps.tasks.models import Task
        from apps.time_tracking.models import TimeEntry

        project = services.get_project_for_user(int(pk), request.user, capability=Capability.VIEW)
        tasks = task_selectors.base_queryset(request.user).filter(project=project, parent__isnull=True)
        now = timezone.now()
        stats = tasks.aggregate(
            total=Count("id"),
            done=Count("id", filter=Q(status=Task.Status.DONE)),
            overdue=Count("id", filter=Q(due_at__lt=now) & ~Q(status__in=["done", "cancelled"])),
            in_progress=Count("id", filter=Q(status=Task.Status.IN_PROGRESS)),
        )
        tracked = TimeEntry.objects.filter(project=project).aggregate(total=Sum("duration_seconds"))["total"] or 0
        by_member = (
            TimeEntry.objects.filter(project=project)
            .values("owner_id", "owner__full_name", "owner__email")
            .annotate(seconds=Sum("duration_seconds"))
            .order_by("-seconds")[:10]
        )
        upcoming = tasks.filter(due_at__gte=now).exclude(status__in=["done", "cancelled"]).order_by("due_at")[:5]
        from apps.tasks.serializers import TaskSerializer

        return Response(
            {
                "stats": stats,
                "tracked_seconds": tracked,
                "time_by_member": [
                    {
                        "user_id": row["owner_id"],
                        "display_name": row["owner__full_name"] or row["owner__email"].split("@")[0],
                        "seconds": row["seconds"] or 0,
                    }
                    for row in by_member
                ],
                "upcoming": TaskSerializer(upcoming, many=True, context={"request": request}).data,
            }
        )


@api_view(["POST"])
def accept_invitation(request):
    token = str(request.data.get("token", ""))
    membership = services.accept_invitation(Actor.from_request(request), token=token)
    project = selectors.base_queryset(request.user).filter(pk=membership.project_id).first()
    return Response(ProjectSerializer(project, context={"request": request}).data)


class IdeaViewSet(viewsets.ModelViewSet):
    serializer_class = IdeaSerializer
    ordering_map = {"created": ["created_at"], "updated": ["updated_at"], "title": ["title"]}
    ordering = ["-created"]
    filterset_fields = ["category", "priority"]

    def get_queryset(self):
        qs = Idea.objects.filter(owner=self.request.user).select_related("converted_project")
        converted = self.request.query_params.get("converted")
        if converted == "0":
            qs = qs.filter(converted_project__isnull=True)
        elif converted == "1":
            qs = qs.filter(converted_project__isnull=False)
        return qs

    def create(self, request, *args, **kwargs):
        serializer = IdeaInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        idea = services.create_idea(Actor.from_request(request), **serializer.validated_data)
        return Response(IdeaSerializer(idea).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        serializer = IdeaInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        idea = services.update_idea(Actor.from_request(request), int(kwargs["pk"]), **serializer.validated_data)
        return Response(IdeaSerializer(idea).data)

    def destroy(self, request, *args, **kwargs):
        services.delete_idea(Actor.from_request(request), int(kwargs["pk"]))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def convert(self, request, pk=None):
        kind = request.data.get("kind", Project.Kind.PROJECT)
        if kind not in dict(Project.Kind.choices):
            kind = Project.Kind.PROJECT
        project = services.convert_idea(Actor.from_request(request), int(pk), kind=kind)
        fresh = selectors.base_queryset(request.user).filter(pk=project.pk).first()
        return Response(ProjectSerializer(fresh, context={"request": request}).data, status=status.HTTP_201_CREATED)
