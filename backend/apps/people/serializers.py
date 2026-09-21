from __future__ import annotations

from rest_framework import serializers

from apps.people.models import Person


class PersonUserSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    display_name = serializers.CharField()
    email = serializers.EmailField()


class PersonSerializer(serializers.ModelSerializer):
    user = PersonUserSerializer(read_only=True)
    open_count = serializers.IntegerField(read_only=True, default=0)
    done_count = serializers.IntegerField(read_only=True, default=0)
    last_assigned_at = serializers.DateTimeField(read_only=True, allow_null=True, default=None)

    class Meta:
        model = Person
        fields = ["id", "user", "note", "open_count", "done_count", "last_assigned_at", "created_at"]
        read_only_fields = fields


class PersonCreateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=False, allow_blank=True)
    user_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    note = serializers.CharField(required=False, allow_blank=True, max_length=120, default="")

    def validate(self, attrs):
        if not attrs.get("email") and attrs.get("user_id") is None:
            raise serializers.ValidationError("Give an e-mail or a user id.")
        return attrs


class PersonUpdateSerializer(serializers.Serializer):
    note = serializers.CharField(allow_blank=True, max_length=120)


class DelegatorSerializer(serializers.Serializer):
    user = serializers.SerializerMethodField()
    open_count = serializers.IntegerField()
    done_count = serializers.IntegerField()
    last_assigned_at = serializers.DateTimeField(allow_null=True)

    def get_user(self, obj) -> dict:
        user = obj["user"]
        return {"id": user.pk, "display_name": user.display_name}
