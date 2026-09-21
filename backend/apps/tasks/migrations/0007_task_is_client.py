from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tasks", "0006_taskcheckin_skipped"),
    ]

    operations = [
        migrations.AddField(
            model_name="task",
            name="is_client",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
