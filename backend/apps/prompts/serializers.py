from __future__ import annotations

from django.conf import settings
from rest_framework import serializers

from apps.projects.serializers import ProjectRefSerializer, UserRefSerializer
from apps.prompts.models import Prompt, PromptVersion
from common.models import Visibility
from common.permissions import Capability, can_edit_object


class PromptListSerializer(serializers.ModelSerializer):
    """Lightweight list representation: snippet only, never the full body."""

    project = ProjectRefSerializer(read_only=True)
    snippet = serializers.SerializerMethodField()
    tags = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Prompt
        fields = [
            "id",
            "title",
            "snippet",
            "description",
            "category",
            "tags",
            "project",
            "visibility",
            "is_favorite",
            "is_archived",
            "body_length",
            "version",
            "updated_at",
            "created_at",
            "is_owner",
        ]
        read_only_fields = fields

    def get_snippet(self, obj: Prompt) -> str:
        return obj.snippet(settings.PROMPT_SNIPPET_LENGTH)

    def get_tags(self, obj: Prompt) -> list[str]:
        return [tag.name for tag in obj.tags.all()]

    def get_is_owner(self, obj: Prompt) -> bool:
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated and obj.owner_id == request.user.pk)


class PromptDetailSerializer(PromptListSerializer):
    body = serializers.CharField(read_only=True)
    created_by = UserRefSerializer(read_only=True)
    last_edited_by = UserRefSerializer(read_only=True)
    version_count = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()

    class Meta(PromptListSerializer.Meta):
        fields = [
            *PromptListSerializer.Meta.fields,
            "body",
            "created_by",
            "last_edited_by",
            "version_count",
            "can_edit",
        ]
        read_only_fields = fields

    def get_version_count(self, obj: Prompt) -> int:
        return getattr(obj, "version_count", None) or obj.versions.count()

    def get_can_edit(self, obj: Prompt) -> bool:
        request = self.context.get("request")
        return can_edit_object(
            getattr(request, "user", None),
            owner_id=obj.owner_id,
            project=obj.project,
            visibility=obj.visibility,
            capability=Capability.EDIT_SHARED_PROMPTS,
        )


class PromptVersionSerializer(serializers.ModelSerializer):
    edited_by = UserRefSerializer(read_only=True)
    snippet = serializers.SerializerMethodField()

    class Meta:
        model = PromptVersion
        fields = ["id", "number", "title", "snippet", "edited_by", "created_at"]

    def get_snippet(self, obj: PromptVersion) -> str:
        return obj.snippet(settings.PROMPT_SNIPPET_LENGTH)


class PromptVersionDetailSerializer(PromptVersionSerializer):
    body = serializers.CharField(read_only=True)
    description = serializers.CharField(read_only=True)

    class Meta(PromptVersionSerializer.Meta):
        fields = [*PromptVersionSerializer.Meta.fields, "body", "description"]


class PromptInputSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=250, required=False)
    body = serializers.CharField(required=False, trim_whitespace=False)
    description = serializers.CharField(required=False, allow_blank=True)
    category = serializers.CharField(max_length=60, required=False, allow_blank=True)
    tags = serializers.ListField(child=serializers.CharField(max_length=40), required=False)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    visibility = serializers.ChoiceField(choices=Visibility.choices, required=False, allow_null=True)
    is_favorite = serializers.BooleanField(required=False)
    is_archived = serializers.BooleanField(required=False)
    version = serializers.IntegerField(required=False, write_only=True)
