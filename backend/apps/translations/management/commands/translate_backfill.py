"""Queue translations for existing content. Usage: manage.py translate_backfill [--user EMAIL] [--limit N]"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from apps.translations.services import backfill_for_user, enabled


class Command(BaseCommand):
    help = "Queue background translations for content that has none yet."

    def add_arguments(self, parser):
        parser.add_argument("--user", help="Only this user's content (email).")
        parser.add_argument("--limit", type=int, default=500, help="Max objects to queue per user.")

    def handle(self, *args, **options):
        if not enabled():
            raise CommandError("Translations are disabled or ANTHROPIC_API_KEY is not configured.")
        User = get_user_model()
        users = User.objects.filter(is_active=True)
        if options["user"]:
            users = users.filter(email__iexact=options["user"])
            if not users.exists():
                raise CommandError("User not found.")
        total = 0
        for user in users.iterator():
            queued = backfill_for_user(user.pk, limit=options["limit"])
            total += queued
            self.stdout.write(f"{user.email}: queued {queued}")
        self.stdout.write(self.style.SUCCESS(f"Queued {total} translation(s)."))
