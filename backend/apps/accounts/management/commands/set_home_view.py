"""
Set which page a user lands on after login.

    manage.py set_home_view drogoz@example.com projects     # Working projects catalog
    manage.py set_home_view drogoz@example.com dashboard     # classic dashboard (default)

Used to switch the owner's account onto the Working projects home after deploy, without touching
anyone else's experience. Idempotent; prints the before/after value.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User, UserPreference


class Command(BaseCommand):
    help = "Set a user's home page (dashboard | projects) by email or id."

    def add_arguments(self, parser):
        parser.add_argument("user", help="User email or numeric id.")
        parser.add_argument("view", choices=[c.value for c in UserPreference.HomeView], help="dashboard or projects")

    def handle(self, *args, **options):
        identifier: str = options["user"]
        view: str = options["view"]

        user = User.objects.filter(email__iexact=identifier).first()
        if user is None and identifier.isdigit():
            user = User.objects.filter(pk=int(identifier)).first()
        if user is None:
            raise CommandError(f"No user found for {identifier!r}.")

        prefs, _ = UserPreference.objects.get_or_create(user=user)
        previous = prefs.home_view
        prefs.home_view = view
        prefs.save(update_fields=["home_view"])

        self.stdout.write(self.style.SUCCESS(f"{user.email}: home_view {previous} -> {prefs.home_view}"))
