from __future__ import annotations

from rest_framework import serializers

from apps.tasks.models import RecurrenceRule, Task
from common.models import Priority, Visibility
from common.permissions import Capability, can_edit_object


class UserRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    display_name = serializers.CharField()


class ProjectRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()
    kind = serializers.CharField()
    mode = serializers.CharField()


class RecurrenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = RecurrenceRule
        fields = ["id", "freq", "interval", "byweekday", "bymonthday", "until"]
        read_only_fields = ["id"]


class RecurrenceInputSerializer(serializers.Serializer):
    freq = serializers.ChoiceField(choices=RecurrenceRule.Freq.choices)
    interval = serializers.IntegerField(min_value=1, max_value=365, required=False, default=1)
    byweekday = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6), required=False, default=list
    )
    bymonthday = serializers.IntegerField(min_value=1, max_value=31, required=False, allow_null=True)
    until = serializers.DateField(required=False, allow_null=True)
    count = serializers.IntegerField(min_value=1, max_value=1000, required=False, allow_null=True)


class TaskSerializer(serializers.ModelSerializer):
    owner = UserRefSerializer(read_only=True)
    assignee = UserRefSerializer(read_only=True)
    completed_by = UserRefSerializer(read_only=True)
    project = ProjectRefSerializer(read_only=True)
    recurrence = RecurrenceSerializer(read_only=True)
    subtask_total = serializers.IntegerField(read_only=True, default=0)
    subtask_done = serializers.IntegerField(read_only=True, default=0)
    tracked_seconds = serializers.IntegerField(read_only=True, default=0)
    comment_count = serializers.IntegerField(read_only=True, default=0)
    is_overdue = serializers.BooleanField(read_only=True)
    completed_by_name = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "kind",
            "origin",
            "title",
            "description",
            "notes",
            "status",
            "priority",
            "visibility",
            "project",
            "parent",
            "owner",
            "assignee",
            "start_at",
            "due_at",
            "due_has_time",
            "reminder_at",
            "estimated_minutes",
            "tracked_seconds",
            "tags",
            "sort_order",
            "version",
            "is_overdue",
            "subtask_total",
            "subtask_done",
            "comment_count",
            "completed_at",
            "completed_by",
            "completed_by_name",
            "completion_source",
            "recurrence",
            "created_at",
            "updated_at",
            "can_edit",
            "can_delete",
        ]
        read_only_fields = fields

    def get_completed_by_name(self, obj: Task) -> str | None:
        if obj.completed_by_guest_id:
            return obj.completed_by_guest.display_name
        if obj.completed_by_id:
            return obj.completed_by.display_name
        return None

    def _user(self):
        request = self.context.get("request")
        return getattr(request, "user", None)

    def get_can_edit(self, obj: Task) -> bool:
        return can_edit_object(self._user(), owner_id=obj.owner_id, project=obj.project, visibility=obj.visibility)

    def get_can_delete(self, obj: Task) -> bool:
        user = self._user()
        if user is None or not user.is_authenticated:
            return False
        if obj.owner_id == user.pk:
            return True
        return can_edit_object(
            user,
            owner_id=obj.owner_id,
            project=obj.project,
            visibility=obj.visibility,
            capability=Capability.DELETE_TASK,
        )


class TaskWithSubtasksSerializer(TaskSerializer):
    subtasks = serializers.SerializerMethodField()

    class Meta(TaskSerializer.Meta):
        fields = [*TaskSerializer.Meta.fields, "subtasks"]
        read_only_fields = fields

    def get_subtasks(self, obj: Task) -> list[dict]:
        items = getattr(obj, "prefetched_subtasks", None)
        if items is None:
            items = obj.subtasks.filter(deleted_at__isnull=True).select_related("assignee", "owner", "project")
        return TaskSerializer(items, many=True, context=self.context).data


class TaskCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300)
    kind = serializers.ChoiceField(choices=Task.Kind.choices, required=False, default=Task.Kind.PERSONAL)
    origin = serializers.ChoiceField(choices=Task.Origin.choices, required=False, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    priority = serializers.ChoiceField(choices=Priority.choices, required=False, default=Priority.NORMAL)
    visibility = serializers.ChoiceField(choices=Visibility.choices, required=False, allow_null=True)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    parent_id = serializers.IntegerField(required=False, allow_null=True)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    due_has_time = serializers.BooleanField(required=False, default=False)
    reminder_at = serializers.DateTimeField(required=False, allow_null=True)
    estimated_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)
    tags = serializers.ListField(child=serializers.CharField(max_length=40), required=False, default=list)
    recurrence = RecurrenceInputSerializer(required=False, allow_null=True)


class TaskUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=300, required=False)
    kind = serializers.ChoiceField(choices=Task.Kind.choices, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    priority = serializers.ChoiceField(choices=Priority.choices, required=False)
    status = serializers.ChoiceField(choices=[Task.Status.TODO, Task.Status.IN_PROGRESS], required=False)
    visibility = serializers.ChoiceField(choices=Visibility.choices, required=False)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    assignee_id = serializers.IntegerField(required=False, allow_null=True)
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    due_has_time = serializers.BooleanField(required=False)
    reminder_at = serializers.DateTimeField(required=False, allow_null=True)
    estimated_minutes = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=100000)
    tags = serializers.ListField(child=serializers.CharField(max_length=40), required=False)
    sort_order = serializers.IntegerField(required=False)
    recurrence = RecurrenceInputSerializer(required=False, allow_null=True)
    version = serializers.IntegerField(required=False, write_only=True)


class BulkRescheduleSerializer(serializers.Serializer):
    task_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False, max_length=200)
    due_at = serializers.DateTimeField(allow_null=True)
    due_has_time = serializers.BooleanField(required=False, default=False)
