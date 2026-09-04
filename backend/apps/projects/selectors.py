from __future__ import annotations

from django.db.models import Count, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce

from apps.projects.models import Project, ProjectMembership


def base_queryset(user):
    from apps.prompts.models import Prompt
    from apps.time_tracking.models import TimeEntry

    members = (
        ProjectMembership.objects.filter(project=OuterRef("pk"), accepted_at__isnull=False)
        .values("project")
        .annotate(c=Count("*"))
        .values("c")[:1]
    )
    prompts = (
        Prompt.objects.visible_to(user)
        .filter(project=OuterRef("pk"), is_archived=False)
        .values("project")
        .annotate(c=Count("*"))
        .values("c")[:1]
    )
    tracked = (
        TimeEntry.objects.filter(project=OuterRef("pk"))
        .values("project")
        .annotate(total=Sum("duration_seconds"))
        .values("total")[:1]
    )
    return (
        Project.objects.visible_to(user)
        .with_progress(user)
        .select_related("owner")
        .annotate(
            member_count=Coalesce(Subquery(members, output_field=IntegerField()), Value(0)),
            prompt_count=Coalesce(Subquery(prompts, output_field=IntegerField()), Value(0)),
            tracked_seconds=Coalesce(Subquery(tracked, output_field=IntegerField()), Value(0)),
        )
    )


def active_projects(user, *, with_open_tasks: bool = False):
    qs = base_queryset(user).filter(
        Q(kind=Project.Kind.ACTIVE) | Q(status=Project.Status.ACTIVE),
        status__in=[Project.Status.ACTIVE, Project.Status.PAUSED],
    )
    if with_open_tasks:
        qs = qs.filter(task_open__gt=0)
    return qs
