from django.db import migrations, models


def from_flag(apps, schema_editor):
    apps.get_model("projects", "Project").objects.filter(is_working=True).update(work_state="working")


class Migration(migrations.Migration):
    dependencies = [("projects", "0007_work_group")]

    operations = [
        migrations.AddField(
            model_name="project",
            name="work_state",
            field=models.CharField(
                choices=[("waiting", "Waiting"), ("active", "Active"), ("working", "Working")],
                db_index=True,
                default="waiting",
                max_length=8,
            ),
        ),
        migrations.RunPython(from_flag, migrations.RunPython.noop),
    ]
