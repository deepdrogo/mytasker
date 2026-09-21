from django.conf import settings
from django.db import migrations, models


def seed_from_assignee(apps, schema_editor):
    """Existing single assignees become the first member of the new set."""
    Task = apps.get_model("tasks", "Task")
    for task in Task.objects.filter(assignee__isnull=False).only("id", "assignee_id").iterator():
        task.assignees.add(task.assignee_id)


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0007_task_is_client"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="assignees",
            field=models.ManyToManyField(
                blank=True, db_table="tasks_task_assignees", related_name="handed_tasks", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.RunPython(seed_from_assignee, migrations.RunPython.noop),
    ]
