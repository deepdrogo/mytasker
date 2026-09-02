from __future__ import annotations

from rest_framework import serializers

from apps.collab.models import ActivityEvent, Comment
from apps.projects.serializers import ProjectRefSerializer, UserRefSerializer
from common.permissions import Capability, project_access


class CommentSerializer(serializers.ModelSerializer):
    author = UserRefSerializer(read_only=True)
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "author", "body", "task", "project", "edited_at", "created_at", "can_edit", "can_delete"]
        read_only_fields = fields

    def _user(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def get_can_edit(self, obj: Comment) -> bool:
        user = self._user()
        return bool(user and obj.author_id == user.pk)

    def get_can_delete(self, obj: Comment) -> bool:
        user = self._user()
        if not user:
            return False
        if obj.author_id == user.pk:
            return True
        project = obj.project or (obj.task.project if obj.task_id else None)
        return project is not None and project_access(user, project).can(Capability.MANAGE_PROJECT)


class CommentInputSerializer(serializers.Serializer):
    body = serializers.CharField(max_length=5000)
    task_id = serializers.IntegerField(required=False, allow_null=True)
    project_id = serializers.IntegerField(required=False, allow_null=True)


class ActivitySerializer(serializers.ModelSerializer):
    project = ProjectRefSerializer(read_only=True)

    class Meta:
        model = ActivityEvent
        fields = [
            "id",
            "name",
            "actor_display",
            "actor_kind",
            "source",
            "target_type",
            "target_id",
            "project",
            "payload",
            "created_at",
        ]
        read_only_fields = fields
