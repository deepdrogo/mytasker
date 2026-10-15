from django.db import migrations


def reset_order(apps, schema_editor):
    # The old numbering covered only the dashboard's projects. The calendar now shares the order, so everyone
    # starts from date order and builds the hand-made order from there.
    apps.get_model("projects", "Project").objects.exclude(sort_order=0).update(sort_order=0)


class Migration(migrations.Migration):
    dependencies = [("projects", "0003_daily_checkin")]

    operations = [migrations.RunPython(reset_order, migrations.RunPython.noop)]
