from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0007_cycle_targets'),
    ]

    operations = [
        migrations.AddField(
            model_name='userpreference',
            name='cycle_reset_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
