from __future__ import annotations

from rest_framework import serializers

from apps.routines.models import RoutineItem, Rule


class RoutineItemSerializer(serializers.ModelSerializer):
    kind = serializers.CharField(source="routine.kind", read_only=True)
    today_completed = serializers.SerializerMethodField()
    today_minutes = serializers.SerializerMethodField()

    class Meta:
        model = RoutineItem
        fields = [
            "id",
            "routine",
            "kind",
            "name",
            "description",
            "target_minutes",
            "start_time",
            "end_time",
            "repeat_days",
            "order",
            "counts_as_business",
            "is_active",
            "today_completed",
            "today_minutes",
        ]
        read_only_fields = ["id", "routine", "kind", "today_completed", "today_minutes"]

    def _completion(self, obj):
        completions = self.context.get("completions") or {}
        return completions.get(obj.pk)

    def get_today_completed(self, obj) -> bool:
        completion = self._completion(obj)
        return bool(completion and completion.completed)

    def get_today_minutes(self, obj) -> int:
        completion = self._completion(obj)
        if completion and completion.manual_minutes is not None:
            return completion.manual_minutes
        tracked = self.context.get("tracked") or {}
        return int(tracked.get(obj.pk, 0) // 60)


class RoutineItemInputSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    description = serializers.CharField(max_length=300, required=False, allow_blank=True)
    target_minutes = serializers.IntegerField(min_value=0, max_value=1440, required=False)
    start_time = serializers.TimeField(required=False, allow_null=True)
    end_time = serializers.TimeField(required=False, allow_null=True)
    repeat_days = serializers.IntegerField(min_value=0, max_value=127, required=False)
    order = serializers.IntegerField(required=False)
    counts_as_business = serializers.BooleanField(required=False)
    is_active = serializers.BooleanField(required=False)


class CompletionSerializer(serializers.Serializer):
    completed = serializers.BooleanField()
    date = serializers.DateField(required=False)
    manual_minutes = serializers.IntegerField(min_value=0, max_value=1440, required=False, allow_null=True)


class RuleSerializer(serializers.ModelSerializer):
    # None = not checked today, True = kept, False = broken.
    today_kept = serializers.SerializerMethodField()
    streak = serializers.SerializerMethodField()

    class Meta:
        model = Rule
        fields = ["id", "text", "description", "order", "is_enabled", "today_kept", "streak"]
        read_only_fields = ["id", "today_kept", "streak"]

    def get_today_kept(self, obj) -> bool | None:
        completions = self.context.get("rule_completions") or {}
        row = completions.get(obj.pk)
        return None if row is None else bool(row.kept)

    def get_streak(self, obj) -> int:
        streaks = self.context.get("rule_streaks") or {}
        return int(streaks.get(obj.pk, 0))


class RuleKeptSerializer(serializers.Serializer):
    kept = serializers.BooleanField(allow_null=True)
    date = serializers.DateField(required=False)


class RuleInputSerializer(serializers.Serializer):
    text = serializers.CharField(max_length=200, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    order = serializers.IntegerField(required=False)
    is_enabled = serializers.BooleanField(required=False)


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.IntegerField(), max_length=500)
