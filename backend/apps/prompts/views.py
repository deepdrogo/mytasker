from __future__ import annotations

import django_filters as filters
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import Count, F, Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.prompts import services
from apps.prompts.models import Prompt, PromptTag, PromptVersion
from apps.prompts.serializers import (
    PromptDetailSerializer,
    PromptInputSerializer,
    PromptListSerializer,
    PromptVersionDetailSerializer,
    PromptVersionSerializer,
)
from common.actors import Actor


class PromptFilter(filters.FilterSet):
    q = filters.CharFilter(method="filter_q")
    category = filters.CharFilter(field_name="category")
    tag = filters.CharFilter(method="filter_tag")
    project = filters.NumberFilter(field_name="project_id")
    has_project = filters.BooleanFilter(method="filter_has_project")
    favorite = filters.BooleanFilter(field_name="is_favorite")
    archived = filters.BooleanFilter(field_name="is_archived")
    visibility = filters.CharFilter(field_name="visibility")
    owned = filters.BooleanFilter(method="filter_owned")

    class Meta:
        model = Prompt
        fields: list[str] = []

    def filter_q(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset
        query = SearchQuery(value, config="english", search_type="websearch")
        return (
            queryset.filter(Q(search_vector=query) | Q(title__icontains=value))
            .annotate(rank=SearchRank(F("search_vector"), query))
            .order_by("-rank", "-updated_at")
        )

    def filter_tag(self, queryset, name, value):
        return queryset.filter(tags__slug=value)

    def filter_has_project(self, queryset, name, value):
        return queryset.filter(project__isnull=not value)

    def filter_owned(self, queryset, name, value):
        return queryset.filter(owner=self.request.user) if value else queryset.exclude(owner=self.request.user)


class PromptViewSet(viewsets.ModelViewSet):
    serializer_class = PromptListSerializer
    filterset_class = PromptFilter
    ordering_map = {
        "updated": ["updated_at"],
        "created": ["created_at"],
        "title": ["title"],
        "favorite": ["is_favorite", "-updated_at"],
        "length": ["body_length"],
    }
    ordering = ["-updated"]

    def get_queryset(self):
        qs = (
            Prompt.objects.visible_to(self.request.user)
            .select_related("project", "owner", "created_by", "last_edited_by")
            .prefetch_related("tags")
        )
        if self.action == "list" and self.request.query_params.get("archived") is None:
            qs = qs.filter(is_archived=False)
        if self.action == "list":
            # Never load the full body for list views.
            qs = qs.defer("body", "search_vector")
        else:
            qs = qs.annotate(version_count=Count("versions", distinct=True))
        return qs

    def get_serializer_class(self):
        return PromptDetailSerializer if self.action != "list" else PromptListSerializer

    def _actor(self) -> Actor:
        return Actor.from_request(self.request)

    def _respond(self, prompt: Prompt, code: int = status.HTTP_200_OK) -> Response:
        fresh = (
            Prompt.objects.visible_to(self.request.user)
            .select_related("project", "owner", "created_by", "last_edited_by")
            .prefetch_related("tags")
            .annotate(version_count=Count("versions", distinct=True))
            .filter(pk=prompt.pk)
            .first()
        )
        return Response(
            PromptDetailSerializer(fresh or prompt, context=self.get_serializer_context()).data, status=code
        )

    def create(self, request, *args, **kwargs):
        serializer = PromptInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        data.pop("version", None)
        if "title" not in data or "body" not in data:
            from common.exceptions import ValidationFailed

            raise ValidationFailed(
                "Title and body are required.", fields={"title": ["Required."], "body": ["Required."]}
            )
        prompt = services.create_prompt(self._actor(), **data)
        return self._respond(prompt, status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        return self.partial_update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        serializer = PromptInputSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        expected_version = data.pop("version", None)
        kwargs_extra = {}
        if "project_id" in data:
            kwargs_extra["project_id"] = data.pop("project_id")
        prompt = services.update_prompt(
            self._actor(), int(kwargs["pk"]), expected_version=expected_version, **kwargs_extra, **data
        )
        return self._respond(prompt)

    def destroy(self, request, *args, **kwargs):
        services.delete_prompt(self._actor(), int(kwargs["pk"]))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def duplicate(self, request, pk=None):
        prompt = services.duplicate_prompt(self._actor(), int(pk))
        return self._respond(prompt, status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"])
    def favorite(self, request, pk=None):
        prompt = services.get_prompt_for_user(int(pk), request.user)
        prompt = services.update_prompt(self._actor(), prompt.pk, is_favorite=not prompt.is_favorite)
        return self._respond(prompt)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        prompt = services.get_prompt_for_user(int(pk), request.user)
        prompt = services.update_prompt(self._actor(), prompt.pk, is_archived=not prompt.is_archived)
        return self._respond(prompt)

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        prompt = services.get_prompt_for_user(int(pk), request.user)
        versions = PromptVersion.objects.filter(prompt=prompt).select_related("edited_by").defer("body")[:100]
        return Response(PromptVersionSerializer(versions, many=True).data)

    @action(detail=True, methods=["get", "post"], url_path=r"versions/(?P<number>\d+)")
    def version(self, request, pk=None, number=None):
        prompt = services.get_prompt_for_user(int(pk), request.user)
        if request.method == "POST":
            restored = services.restore_version(self._actor(), prompt.pk, int(number))
            return self._respond(restored)
        version = PromptVersion.objects.filter(prompt=prompt, number=int(number)).select_related("edited_by").first()
        if version is None:
            from common.exceptions import NotFound

            raise NotFound("Version not found.")
        return Response(PromptVersionDetailSerializer(version).data)

    @action(detail=False, methods=["get"])
    def facets(self, request):
        """Categories and tags for filter chips."""
        visible = Prompt.objects.visible_to(request.user).filter(is_archived=False)
        categories = (
            visible.exclude(category="").values("category").annotate(count=Count("id")).order_by("-count", "category")
        )
        tags = (
            PromptTag.objects.filter(prompts__in=visible)
            .values("name", "slug")
            .annotate(count=Count("prompts", distinct=True))
            .order_by("-count", "name")[:50]
        )
        return Response({"categories": list(categories), "tags": list(tags)})
