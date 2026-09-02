from __future__ import annotations

from rest_framework import serializers

from apps.projects.serializers import ProjectRefSerializer
from apps.time_tracking.models import SleepSession, TimeEntry


class TaskRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    title = serializers.CharField()
    kind = serializers.CharField()


class RoutineItemRefSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name = serializers.CharField()


class TimeEntrySerializer(serializers.ModelSerializer):
    task = TaskRefSerializer(read_only=True)
    project = ProjectRefSerializer(read_only=True)
    routine_item = RoutineItemRefSerializer(read_only=True)
    is_running = serializers.BooleanField(read_only=True)
    current_seconds = serializers.SerializerMethodField()

    class Meta:
        model = TimeEntry
        fields = [
            "id",
            "category",
            "task",
            "project",
            "routine_item",
            "started_at",
            "ended_at",
            "duration_seconds",
            "current_seconds",
            "is_running",
            "note",
            "is_manual",
            "source",
            "resumed_from",
        ]
        read_only_fields = fields

    def get_current_seconds(self, obj: TimeEntry) -> int:
        return obj.current_seconds()


class StartTimerSerializer(serializers.Serializer):
    task_id = serializers.IntegerField(required=False, allow_null=True)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    routine_item_id = serializers.IntegerField(required=False, allow_null=True)
    category = serializers.ChoiceField(choices=TimeEntry.Category.choices, required=False, allow_null=True)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)


class ManualEntrySerializer(StartTimerSerializer):
    started_at = serializers.DateTimeField()
    ended_at = serializers.DateTimeField()


class UpdateEntrySerializer(serializers.Serializer):
    started_at = serializers.DateTimeField(required=False)
    ended_at = serializers.DateTimeField(required=False)
    note = serializers.CharField(max_length=300, required=False, allow_blank=True)
    category = serializers.ChoiceField(choices=TimeEntry.Category.choices, required=False)
    task_id = serializers.IntegerField(required=False, allow_null=True)
    project_id = serializers.IntegerField(required=False, allow_null=True)
    routine_item_id = serializers.IntegerField(required=False, allow_null=True)


class SleepSessionSerializer(serializers.ModelSerializer):
    is_running = serializers.BooleanField(read_only=True)
    current_seconds = serializers.SerializerMethodField()

    class Meta:
        model = SleepSession
        fields = [
            "id",
            "started_at",
            "ended_at",
            "duration_seconds",
            "current_seconds",
            "is_running",
            "is_manual",
            "note",
        ]
        read_only_fields = fields

    def get_current_seconds(self, obj: SleepSession) -> int:
        return obj.current_seconds()


class ManualSleepSerializer(serializers.Serializer):
    started_at = serializers.DateTimeField()
    ended_at = serializers.DateTimeField()
    note = serializers.CharField(max_length=200, required=False, allow_blank=True)
