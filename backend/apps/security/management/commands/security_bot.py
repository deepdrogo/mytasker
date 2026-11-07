from django.core.management.base import BaseCommand

from apps.security.bot import SecurityBot


class Command(BaseCommand):
    help = "Run the owner-only security Telegram bot (long polling)."

    def handle(self, *args, **options):
        SecurityBot().run_forever()
