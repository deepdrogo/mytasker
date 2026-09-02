"""Global search across tasks, projects, prompts, ideas and routine items - visibility enforced."""

from __future__ import annotations

from django.contrib.postgres.search import SearchQuery, SearchRank, TrigramSimilarity
from django.db.models import F, Q
from rest_framework.decorators import api_view, throttle_classes
from rest_framework.response import Response

from common.throttling import SearchThrottle


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
    from apps.tasks.serializers import TaskSerializer

    user = request.user
    term = (request.query_params.get("q") or "").strip()[:200]
    limit = min(int(request.query_params.get("limit", 8)), 25)
    context = {"request": request}

    if len(term) < 2:
        return Response({"tasks": [], "projects": [], "prompts": [], "ideas": [], "routine_items": []})

    query = SearchQuery(term, config="english", search_type="websearch")

    tasks = (
        selectors.base_queryset(user)
        .filter(Q(search_vector=query) | Q(title__icontains=term))
        .exclude(status="cancelled")
        .annotate(rank=SearchRank(F("search_vector"), query))
        .order_by("-rank", "status", "-updated_at")[:limit]
    )

    projects = (
        Project.objects.visible_to(user)
        .annotate(sim=TrigramSimilarity("name", term))
        .filter(Q(name__icontains=term) | Q(sim__gt=0.3) | Q(description__icontains=term))
        .with_progress()
        .select_related("owner")
        .order_by("-sim", "-updated_at")[:limit]
    )

    prompts = (
        Prompt.objects.visible_to(user)
        .filter(Q(search_vector=query) | Q(title__icontains=term))
        .annotate(rank=SearchRank(F("search_vector"), query))
        .select_related("project", "owner")
        .prefetch_related("tags")
        .order_by("-rank", "-updated_at")[:limit]
    )

    ideas = Idea.objects.filter(owner=user).filter(
        Q(title__icontains=term) | Q(raw_text__icontains=term) | Q(improved_text__icontains=term)
    )[:limit]

    routine_items = RoutineItem.objects.filter(
        routine__owner=user, routine__deleted_at__isnull=True, name__icontains=term
    ).select_related("routine")[:limit]

    return Response(
        {
            "tasks": TaskSerializer(tasks, many=True, context=context).data,
            "projects": ProjectSerializer(projects, many=True, context=context).data,
            "prompts": PromptListSerializer(prompts, many=True, context=context).data,
            "ideas": IdeaSerializer(ideas, many=True, context=context).data,
            "routine_items": RoutineItemSerializer(routine_items, many=True, context=context).data,
        }
    )
