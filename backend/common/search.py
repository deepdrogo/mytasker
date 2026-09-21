"""
Global search across tasks, projects, prompts, ideas and routine items - visibility enforced.

Built for a type-ahead box: every word of the query must appear somewhere in the item (title, description,
notes, tags, the project it belongs to ...), so "video mymask" finds the MyMask task about a video card
regardless of word order. Full-text rank is used only as an extra way in; substring matching is what makes
it feel instant and predictable, including for Georgian text that no stemmer understands.
"""

from __future__ import annotations

import re

from django.contrib.postgres.search import SearchQuery, TrigramSimilarity
from django.db.models import Case, F, Func, IntegerField, Q, TextField, Value, When
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from common.throttling import SearchThrottle

EMPTY = {"tasks": [], "projects": [], "prompts": [], "ideas": [], "routine_items": []}


def _words(term: str) -> list[str]:
    return [word for word in re.split(r"\s+", term) if word]


def _all_words(words: list[str], *fields: str) -> Q:
    """AND across words, OR across fields: each word has to show up in at least one of the fields."""
    condition = Q()
    for word in words:
        any_field = Q()
        for field in fields:
            any_field |= Q(**{f"{field}__icontains": word})
        condition &= any_field
    return condition


def _title_hit(field: str, term: str):
    """0 when the whole phrase is inside the main text, 1 otherwise - exact phrases float to the top."""
    return Case(When(**{f"{field}__icontains": term}, then=Value(0)), default=Value(1), output_field=IntegerField())


@api_view(["GET"])
@throttle_classes([SearchThrottle])
def global_search(request):
    from apps.projects.models import Idea, Project
    from apps.projects.serializers import IdeaSerializer, ProjectSerializer
    from apps.prompts.models import Prompt
    from apps.prompts.serializers import PromptListSerializer
    from apps.routines.models import RoutineItem
    from apps.routines.serializers import RoutineItemSerializer
    from apps.tasks import selectors
    from apps.tasks.models import Task
    from apps.tasks.serializers import TaskSerializer

    user = request.user
    term = (request.query_params.get("q") or "").strip()[:200]
    limit = max(1, min(int(request.query_params.get("limit", 8)), 25))
    context = {"request": request}

    words = _words(term)
    if not words:
        return Response(EMPTY)

    query = SearchQuery(term, config="english", search_type="websearch")

    tasks = (
        selectors.base_queryset(user)
        .annotate(tags_text=Func(F("tags"), Value(" "), function="array_to_string", output_field=TextField()))
        .filter(
            _all_words(words, "title", "description", "notes", "tags_text", "project__name") | Q(search_vector=query)
        )
        .exclude(status=Task.Status.CANCELLED)
        .annotate(
            title_hit=_title_hit("title", term),
            done_last=Case(
                When(status=Task.Status.DONE, then=Value(1)), default=Value(0), output_field=IntegerField()
            ),
            sim=TrigramSimilarity("title", term),
        )
        .order_by("done_last", "title_hit", "-is_client", "-sim", "-updated_at")[:limit]
    )

    projects = (
        Project.objects.visible_to(user)
        .annotate(sim=TrigramSimilarity("name", term))
        .filter(_all_words(words, "name", "description", "notes") | Q(sim__gt=0.3))
        .annotate(title_hit=_title_hit("name", term))
        .with_progress()
        .select_related("owner")
        .order_by("title_hit", "-sim", "-updated_at")[:limit]
    )

    prompts = (
        Prompt.objects.visible_to(user)
        .filter(
            _all_words(words, "title", "description", "body", "category", "tags__name", "project__name")
            | Q(search_vector=query)
        )
        .annotate(title_hit=_title_hit("title", term))
        .select_related("project", "owner")
        .prefetch_related("tags")
        .order_by("title_hit", "-updated_at")
        .distinct()[:limit]
    )

    ideas = (
        Idea.objects.filter(owner=user)
        .filter(_all_words(words, "title", "raw_text", "improved_text", "notes", "category"))
        .annotate(title_hit=_title_hit("title", term))
        .order_by("title_hit", "-updated_at")[:limit]
    )

    routine_items = (
        RoutineItem.objects.filter(routine__owner=user, routine__deleted_at__isnull=True)
        .filter(_all_words(words, "name", "description"))
        .annotate(title_hit=_title_hit("name", term))
        .select_related("routine")
        .order_by("title_hit", "name")[:limit]
    )

    return Response(
        {
            "tasks": TaskSerializer(tasks, many=True, context=context).data,
            "projects": ProjectSerializer(projects, many=True, context=context).data,
            "prompts": PromptListSerializer(prompts, many=True, context=context).data,
            "ideas": IdeaSerializer(ideas, many=True, context=context).data,
            "routine_items": RoutineItemSerializer(routine_items, many=True, context=context).data,
        }
    )
