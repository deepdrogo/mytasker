from __future__ import annotations

import django_filters as filters
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F, Q
from django.utils import timezone

from apps.tasks.models import Task
from common.tz import day_bounds, week_bounds


class TaskFilter(filters.FilterSet):
    kind = filters.CharFilter(field_name="kind")
    origin = filters.CharFilter(field_name="origin")
    status = filters.BaseInFilter(field_name="status")
    priority = filters.BaseInFilter(field_name="priority")
    project = filters.NumberFilter(field_name="project_id")
    has_project = filters.BooleanFilter(method="filter_has_project")
    assignee = filters.NumberFilter(field_name="assignee_id")
    parent = filters.NumberFilter(field_name="parent_id")
    top_level = filters.BooleanFilter(method="filter_top_level")
    visibility = filters.CharFilter(field_name="visibility")
    tag = filters.CharFilter(method="filter_tag")
    due_before = filters.IsoDateTimeFilter(field_name="due_at", lookup_expr="lt")
    due_after = filters.IsoDateTimeFilter(field_name="due_at", lookup_expr="gte")
    has_due = filters.BooleanFilter(method="filter_has_due")
    completed = filters.BooleanFilter(method="filter_completed")
    overdue = filters.BooleanFilter(method="filter_overdue")
    view = filters.CharFilter(method="filter_view")
    q = filters.CharFilter(method="filter_search")

    class Meta:
        model = Task
        fields: list[str] = []

    def filter_has_project(self, queryset, name, value):
        return queryset.filter(project__isnull=not value)

    def filter_top_level(self, queryset, name, value):
        return queryset.filter(parent__isnull=True) if value else queryset

    def filter_tag(self, queryset, name, value):
        return queryset.filter(tags__contains=[value])

    def filter_has_due(self, queryset, name, value):
        return queryset.filter(due_at__isnull=not value)

    def filter_completed(self, queryset, name, value):
        if value:
            return queryset.filter(status=Task.Status.DONE)
        return queryset.exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])

    def filter_overdue(self, queryset, name, value):
        if not value:
            return queryset
        return queryset.filter(due_at__lt=timezone.now()).exclude(
            status__in=[Task.Status.DONE, Task.Status.CANCELLED]
        )

    def filter_view(self, queryset, name, value):
        """Named date views resolved in the user's timezone."""
        user = self.request.user
        now = timezone.now()
        if value == "today":
            _, end = day_bounds(user)
            return queryset.filter(due_at__lt=end).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        if value == "tomorrow":
            from datetime import timedelta

            from common.tz import today_for

            start, end = day_bounds(user, today_for(user) + timedelta(days=1))
            return queryset.filter(due_at__gte=start, due_at__lt=end)
        if value == "week":
            start, end, _, _ = week_bounds(user)
            return queryset.filter(due_at__lt=end).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        if value == "upcoming":
            _, end = day_bounds(user)
            return queryset.filter(due_at__gte=end).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        if value == "overdue":
            return queryset.filter(due_at__lt=now).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        if value == "no_date":
            return queryset.filter(due_at__isnull=True).exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])
        if value == "completed":
            return queryset.filter(status=Task.Status.DONE)
        return queryset

    def filter_search(self, queryset, name, value):
        value = (value or "").strip()
        if not value:
            return queryset
        query = SearchQuery(value, config="english", search_type="websearch")
        return (
            queryset.filter(Q(search_vector=query) | Q(title__icontains=value))
            .annotate(rank=SearchRank(F("search_vector"), query))
            .order_by("-rank", "-updated_at")
        )
