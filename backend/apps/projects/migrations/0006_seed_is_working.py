from django.db import migrations
from django.db.models import Q


def seed_is_working(apps, schema_editor):
    """
    Give the Working projects catalog a sensible starting point: anything the owner is already treating
    as live — an Active-kind project, or one whose status is Active — is flagged as being worked on.
    Everything else starts as "not working" and can be toggled from the new page. Reversible to all-off.
    """
    Project = apps.get_model("projects", "Project")
    Project.objects.filter(Q(kind="active") | Q(status="active")).update(is_working=True)


def unseed_is_working(apps, schema_editor):
    Project = apps.get_model("projects", "Project")
    Project.objects.update(is_working=False)


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0005_project_is_working"),
    ]

    operations = [
        migrations.RunPython(seed_is_working, unseed_is_working),
    ]
