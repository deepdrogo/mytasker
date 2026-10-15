from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("routines", "0002_rule_completion"),
    ]

    operations = [
        migrations.AddField(
            model_name="routinecompletion",
            name="auto_dismissed",
            field=models.BooleanField(default=False),
        ),
    ]
