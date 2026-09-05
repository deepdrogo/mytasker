from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0005_task_kind_crypto"),
    ]

    operations = [
        migrations.AddField(
            model_name="taskcheckin",
            name="skipped",
            field=models.BooleanField(default=False),
        ),
    ]
