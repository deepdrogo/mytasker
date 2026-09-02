from __future__ import annotations

from rest_framework import serializers

from apps.sharing.models import ShareLink
from apps.tasks.models import Task


class ShareLinkSerializer(serializers.ModelSerializer):
    requires_password = serializers.BooleanField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)
    task_count = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()

    class Meta:
        model = ShareLink
        fields = [
            "id",
            "title",
            "url",
            "token_prefix",
            "requires_password",
            "expires_at",
            "ask_guest_name",
            "allow_complete",
            "allow_reopen",
            "one_time",
            "max_uses",
            "use_count",
            "is_active",
            "revoked_at",
            "last_opened_at",
            "task_count",
            "created_at",
        ]
        read_only_fields = fields

    def get_task_count(self, obj: ShareLink) -> int:
        return getattr(obj, "task_count", None) or obj.items.count()

    def get_url(self, obj: ShareLink) -> str:
        # The full URL is only known at creation time (token is not stored). Later responses show a masked value.
        token = self.context.get("token")
        if token:
            from apps.sharing.services import build_share_url

            return build_share_url(token)
        return f"…/s/{obj.token_prefix}…"


class ShareCreateSerializer(serializers.Serializer):
    task_ids = serializers.ListField(child=serializers.IntegerField(), min_length=1, max_length=200)
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    password = serializers.CharField(max_length=128, required=False, allow_blank=True, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    ask_guest_name = serializers.BooleanField(required=False, default=True)
    allow_complete = serializers.BooleanField(required=False, default=True)
    allow_reopen = serializers.BooleanField(required=False, default=False)
    one_time = serializers.BooleanField(required=False, default=False)
    max_uses = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)


class ShareUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False, allow_blank=True)
    password = serializers.CharField(max_length=128, required=False, allow_blank=True, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
    ask_guest_name = serializers.BooleanField(required=False)
    allow_complete = serializers.BooleanField(required=False)
    allow_reopen = serializers.BooleanField(required=False)
    one_time = serializers.BooleanField(required=False)
    max_uses = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)


class GuestTaskSerializer(serializers.ModelSerializer):
    """Deliberately minimal: guests never see owner, project, notes, tags or internal ids beyond the task."""

    completed_by_name = serializers.SerializerMethodField()
    subtasks = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "status",
            "priority",
            "due_at",
            "completed_at",
            "completed_by_name",
            "subtasks",
        ]
        read_only_fields = fields

    def get_completed_by_name(self, obj: Task) -> str | None:
        if obj.status != Task.Status.DONE:
            return None
        if obj.completed_by_guest_id:
            guest = obj.completed_by_guest
            return guest.display_name if guest else "Guest"
        if obj.completed_by_id:
            return obj.completed_by.display_name if obj.completed_by else None
        return None

    def get_subtasks(self, obj: Task) -> list:
        children = (self.context.get("subtasks") or {}).get(obj.pk, [])
        return GuestTaskSerializer(children, many=True, context={"subtasks": {}}).data
