"""
Register (or inspect) the Telegram webhook for this deployment.

    manage.py telegram_webhook            # set webhook to <SITE_URL>/api/v1/telegram/webhook/
    manage.py telegram_webhook --info     # print current webhook info
    manage.py telegram_webhook --delete   # remove the webhook
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.telegram.client import TelegramClient


class Command(BaseCommand):
    help = "Set, inspect or delete the Telegram bot webhook."

    def add_arguments(self, parser):
        parser.add_argument("--info", action="store_true")
        parser.add_argument("--delete", action="store_true")

    def handle(self, *args, **options):
        if not settings.TELEGRAM_BOT_TOKEN:
            raise CommandError("TELEGRAM_BOT_TOKEN is not set.")
        client = TelegramClient()
        if options["info"]:
            self.stdout.write(str(client.call("getWebhookInfo")))
            return
        if options["delete"]:
            client.call("deleteWebhook", drop_pending_updates=False)
            self.stdout.write(self.style.SUCCESS("Webhook deleted."))
            return
        if not settings.TELEGRAM_WEBHOOK_SECRET:
            raise CommandError("TELEGRAM_WEBHOOK_SECRET is not set.")
        url = f"{settings.SITE_URL.rstrip('/')}/api/v1/telegram/webhook/"
        client.set_webhook(url, settings.TELEGRAM_WEBHOOK_SECRET)
        me = client.call("getMe")
        self.stdout.write(self.style.SUCCESS(f"Webhook set to {url} for @{me.get('username', '?')}"))
