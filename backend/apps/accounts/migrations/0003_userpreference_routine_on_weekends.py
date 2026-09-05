from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_assistant_accounts"),
    ]

    operations = [
        migrations.AddField(
            model_name="userpreference",
            name="routine_on_weekends",
            field=models.BooleanField(default=False),
        ),
    ]
