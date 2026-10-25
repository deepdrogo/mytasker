"""
Soft-archive every one of a user's tasks (reversible). Used to hand the owner a clean slate after
deploy without deleting anything — archived tasks live in the Archive section and can be restored.

    manage.py archive_tasks_for_user admin@mytasker.io           # archive all their tasks
    manage.py archive_tasks_for_user admin@mytasker.io --open    # keep done/cancelled tasks on the lists
    manage.py archive_tasks_for_user admin@mytasker.io --undo    # restore all their archived tasks
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.tasks import services


class Command(BaseCommand):
    help = "Soft-archive (or restore) all tasks owned by a user, by email or id."

    def add_arguments(self, parser):
        parser.add_argument("user", help="User email or numeric id.")
        parser.add_argument(
            "--open", action="store_true", help="Only archive open tasks; keep done/cancelled on the lists."
        )
        parser.add_argument("--undo", action="store_true", help="Restore all of the user's archived tasks instead.")

    def handle(self, *args, **options):
        identifier: str = options["user"]
        user = User.objects.filter(email__iexact=identifier).first()
        if user is None and identifier.isdigit():
            user = User.objects.filter(pk=int(identifier)).first()
        if user is None:
            raise CommandError(f"No user found for {identifier!r}.")

        if options["undo"]:
            count = services.unarchive_all_for_owner(user)
            self.stdout.write(self.style.SUCCESS(f"{user.email}: restored {count} task(s) from the archive."))
            return

        count = services.archive_all_for_owner(user, include_completed=not options["open"])
        self.stdout.write(self.style.SUCCESS(f"{user.email}: archived {count} task(s)."))
