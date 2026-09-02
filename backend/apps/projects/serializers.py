from __future__ import annotations

from rest_framework import serializers

from apps.projects.models import Idea, Project, ProjectMembership
from common.models import Priority
from common.permissions import CAPABILITY_MIN_ROLE, project_access


class UserRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    display_name = serializers.CharField()
    email = serializers.EmailField(required=False)


class ProjectRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Project
        fields = ["id", "name", "kind", "mode"]


class ProjectSerializer(serializers.ModelSerializer):
    owner = UserRefSerializer(read_only=True)
    role = serializers.SerializerMethodField()
    progress = serializers.SerializerMethodField()
    task_total = serializers.SerializerMethodField()
    task_done = serializers.SerializerMethodField()
    open_tasks = serializers.SerializerMethodField()
    member_count = serializers.IntegerField(read_only=True, default=0)
    prompt_count = serializers.IntegerField(read_only=True, default=0)
    tracked_seconds = serializers.IntegerField(read_only=True, default=0)
    capabilities = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = [
            "id",
            "name",
            "description",
            "kind",
            "mode",
            "status",
            "priority",
            "start_date",
            "deadline",
            "notes",
            "owner",
            "role",
            "progress",
            "task_total",
            "task_done",
            "open_tasks",
            "member_count",
            "prompt_count",
            "tracked_seconds",
            "version",
            "created_at",
            "updated_at",
            "capabilities",
        ]
        read_only_fields = fields

    def _access(self, obj):
        request = self.context.get("request")
        return project_access(getattr(request, "user", None), obj)

    def get_role(self, obj) -> str | None:
        return self._access(obj).role

    def get_task_total(self, obj) -> int:
        return int(getattr(obj, "task_total", 0) or 0)

    def get_task_done(self, obj) -> int:
        return int(getattr(obj, "task_done", 0) or 0)

    def get_open_tasks(self, obj) -> int:
        return max(0, self.get_task_total(obj) - self.get_task_done(obj))

    def get_progress(self, obj) -> int:
        total = self.get_task_total(obj)
        return round(self.get_task_done(obj) / total * 100) if total else 0

    def get_capabilities(self, obj) -> dict[str, bool]:
        access = self._access(obj)
        return {name: access.can(name) for name in CAPABILITY_MIN_ROLE}


class ProjectCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    kind = serializers.ChoiceField(choices=Project.Kind.choices, required=False, default=Project.Kind.PROJECT)
    mode = serializers.ChoiceField(choices=Project.Mode.choices, required=False, default=Project.Mode.PRIVATE)
    status = serializers.ChoiceField(choices=Project.Status.choices, required=False, default=Project.Status.ACTIVE)
    priority = serializers.ChoiceField(choices=Priority.choices, required=False, default=Priority.NORMAL)
    start_date = serializers.DateField(required=False, allow_null=True)
    deadline = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")


class ProjectUpdateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    kind = serializers.ChoiceField(choices=Project.Kind.choices, required=False)
    status = serializers.ChoiceField(choices=Project.Status.choices, required=False)
    priority = serializers.ChoiceField(choices=Priority.choices, required=False)
    start_date = serializers.DateField(required=False, allow_null=True)
    deadline = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    sort_order = serializers.IntegerField(required=False)
    version = serializers.IntegerField(required=False, write_only=True)


class ModeChangeSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=Project.Mode.choices)


class MembershipSerializer(serializers.ModelSerializer):
    user = UserRefSerializer(read_only=True)

    class Meta:
        model = ProjectMembership
        fields = ["id", "user", "invited_email", "role", "accepted_at", "created_at"]
        read_only_fields = fields


class InviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    role = serializers.ChoiceField(
        choices=[ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER],
        default=ProjectMembership.Role.MEMBER,
    )


class RoleSerializer(serializers.Serializer):
    role = serializers.ChoiceField(
        choices=[ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER]
    )


class IdeaSerializer(serializers.ModelSerializer):
    converted_project = ProjectRefSerializer(read_only=True)

    class Meta:
        model = Idea
        fields = [
            "id",
            "title",
            "raw_text",
            "improved_text",
            "notes",
            "category",
            "priority",
            "converted_project",
            "converted_at",
            "created_at",
        ]
        read_only_fields = ["id", "converted_project", "converted_at", "created_at"]


class IdeaInputSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False)
    raw_text = serializers.CharField(required=False, allow_blank=True)
    improved_text = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    category = serializers.CharField(max_length=60, required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=Priority.choices, required=False)
