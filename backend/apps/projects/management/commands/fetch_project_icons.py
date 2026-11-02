"""
Fetch (or refresh) project icons, in this process - no worker needed.

    manage.py fetch_project_icons                 # every project with a website or a chosen logo
    manage.py fetch_project_icons --missing       # only those without an icon yet
    manage.py fetch_project_icons --project 19    # one project
    manage.py fetch_project_icons --project 54 --icon-url https://example.com/logo.png
    manage.py fetch_project_icons --catalog https://drogoz.network --owner admin@mytasker.io --alias GNR=GENORYN
    manage.py fetch_project_icons --prune         # also delete icon files no project uses any more

--catalog reads the project cards of a catalog page, matches them to the owner's projects by name, takes each
card's logo as the project's icon and fills an empty website with the card's link. A failed fetch keeps the
icon a project already has.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.models import User
from apps.projects.icons import (
    catalog_entries,
    icon_dir,
    name_key,
    normalize_website,
    refresh_project_icon,
    same_project,
)
from apps.projects.models import Project


class Command(BaseCommand):
    help = "Fetch project icons from their websites, a logo URL or a project catalog page."

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, help="Only this project id.")
        parser.add_argument("--missing", action="store_true", help="Only projects without an icon.")
        parser.add_argument("--icon-url", help="With --project: use this image as the project's logo.")
        parser.add_argument("--catalog", help="Catalog page whose project cards carry name, link and logo.")
        parser.add_argument("--owner", help="With --catalog: whose projects to match (email).")
        parser.add_argument("--alias", action="append", default=[], help="With --catalog: PROJECT=CARD name pairs.")
        parser.add_argument("--dry-run", action="store_true", help="With --catalog: only show the matches.")
        parser.add_argument("--prune", action="store_true", help="Delete icon files no project references.")

    def handle(self, *args, **options):
        if options["catalog"]:
            self._from_catalog(options)
        elif options["icon_url"]:
            if not options["project"]:
                raise CommandError("--icon-url needs --project.")
            Project.objects.filter(pk=options["project"]).update(icon_source=options["icon_url"])
            self._refresh(Project.objects.filter(pk=options["project"]))
        else:
            projects = Project.objects.exclude(website="", icon_source="")
            if options["project"]:
                projects = projects.filter(pk=options["project"])
            if options["missing"]:
                projects = projects.filter(icon_file="")
            self._refresh(projects)
        if options["prune"]:
            self._prune()

    def _refresh(self, projects) -> None:
        for project in projects.order_by("pk"):
            icon = refresh_project_icon(project.pk, keep_on_failure=True)
            mark = self.style.SUCCESS("icon") if icon else self.style.WARNING("none")
            self.stdout.write(f"{project.pk:>5}  {mark}  {project.name}  <{project.icon_source or project.website}>")

    def _from_catalog(self, options) -> None:
        if not options["owner"]:
            raise CommandError("--catalog needs --owner.")
        owner = User.objects.filter(email__iexact=options["owner"]).first()
        if owner is None:
            raise CommandError(f"No user {options['owner']!r}.")
        aliases = {}
        for pair in options["alias"]:
            left, _, right = pair.partition("=")
            aliases[name_key(left)] = right
        entries = catalog_entries(options["catalog"])
        self.stdout.write(f"{len(entries)} cards on {options['catalog']}")

        matched: list[int] = []
        for project in Project.objects.filter(owner=owner).order_by("pk"):
            wanted = aliases.get(name_key(project.name), project.name)
            card = next((entry for entry in entries if same_project(wanted, entry["name"])), None)
            if card is None:
                continue
            self.stdout.write(f"{project.pk:>5}  {project.name}  ->  {card['name']}  <{card['site']}>")
            if options["dry_run"]:
                continue
            fields = {"icon_source": card["logo"]}
            if not project.website:
                try:
                    fields["website"] = normalize_website(card["site"])
                except ValueError:
                    pass
            Project.objects.filter(pk=project.pk).update(**fields)
            matched.append(project.pk)
        if matched:
            self._refresh(Project.objects.filter(pk__in=matched))

    def _prune(self) -> None:
        used = set(Project.all_objects.exclude(icon_file="").values_list("icon_file", flat=True))
        removed = 0
        folder = icon_dir()
        if folder.exists():
            for path in folder.glob("*.png"):
                if path.name not in used:
                    path.unlink()
                    removed += 1
        self.stdout.write(f"pruned {removed} unused file(s)")
