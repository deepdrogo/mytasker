from __future__ import annotations

from celery import shared_task


@shared_task(
    name="apps.projects.tasks.refresh_project_icon",
    rate_limit="30/m",
    soft_time_limit=60,
    time_limit=90,
)
def refresh_project_icon_task(project_id: int) -> str:
    from apps.projects.icons import refresh_project_icon

    return refresh_project_icon(project_id) or "none"
