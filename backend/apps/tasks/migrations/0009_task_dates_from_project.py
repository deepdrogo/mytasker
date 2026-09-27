from datetime import UTC, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db import migrations, models


def _zone(name):
    try:
        return ZoneInfo(name or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def borrow_existing_project_dates(apps, schema_editor):
    """Open undated tasks of projects already on the calendar take the project's start and deadline."""
    Task = apps.get_model("tasks", "Task")
    tasks = (
        Task.objects.filter(
            deleted_at__isnull=True,
            parent__isnull=True,
            is_ongoing=False,
            recurrence__isnull=True,
            status__in=["todo", "in_progress"],
            start_at__isnull=True,
            due_at__isnull=True,
            project__isnull=False,
            project__deleted_at__isnull=True,
        )
        .filter(models.Q(project__start_date__isnull=False) | models.Q(project__deadline__isnull=False))
        .select_related("project", "owner")
    )
    for task in tasks.iterator():
        zone = _zone(task.owner.timezone)
        project = task.project
        start = (
            datetime.combine(project.start_date, time.min, tzinfo=zone).astimezone(UTC)
            if project.start_date
            else None
        )
        due = (
            datetime.combine(project.deadline, time(hour=23, minute=59), tzinfo=zone).astimezone(UTC)
            if project.deadline
            else None
        )
        Task.objects.filter(pk=task.pk).update(
            start_at=start, due_at=due, due_has_time=False, dates_from_project=True
        )


def forget_borrowed_dates(apps, schema_editor):
    Task = apps.get_model("tasks", "Task")
    Task.objects.filter(dates_from_project=True).update(start_at=None, due_at=None, due_has_time=False)


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0008_task_assignees"),
        ("projects", "0002_project_category"),
        ("accounts", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="dates_from_project",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(borrow_existing_project_dates, forget_borrowed_dates),
    ]
