# MyTasker — projects, modes and membership.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from common.models import Priority, SoftDeleteManager, SoftDeleteModel, SoftDeleteQuerySet, TimeStampedModel


class ProjectQuerySet(SoftDeleteQuerySet):
    def visible_to(self, user):
        """Projects the user owns or is an accepted member of. Private projects: owner only."""
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        return self.filter(
            Q(owner=user)
            | Q(
                memberships__user=user,
                memberships__accepted_at__isnull=False,
                mode__in=[Project.Mode.GROUP, Project.Mode.GROUP_PLUS],
            )
        ).distinct()

    def with_progress(self):
        from apps.tasks.models import Task

        base = Task.objects.filter(project=models.OuterRef("pk"), parent__isnull=True, deleted_at__isnull=True)
        return self.annotate(
            task_total=models.Subquery(
                base.values("project").annotate(c=models.Count("*")).values("c")[:1],
                output_field=models.IntegerField(),
            ),
            task_done=models.Subquery(
                base.filter(status=Task.Status.DONE).values("project").annotate(c=models.Count("*")).values("c")[:1],
                output_field=models.IntegerField(),
            ),
        )


class ProjectManager(SoftDeleteManager):
    def get_queryset(self):
        return ProjectQuerySet(self.model, using=self._db).alive()

    def visible_to(self, user):
        return self.get_queryset().visible_to(user)


class Project(TimeStampedModel, SoftDeleteModel):
    class Kind(models.TextChoices):
        PROJECT = "project", "Project"
        ACTIVE = "active", "Active project"

    class Mode(models.TextChoices):
        PRIVATE = "private", "Private"
        GROUP = "group", "Group"
        GROUP_PLUS = "group_plus", "Group Plus"

    class Status(models.TextChoices):
        PLANNED = "planned", "Planned"
        ACTIVE = "active", "Active"
        PAUSED = "paused", "Paused"
        COMPLETED = "completed", "Completed"
        ARCHIVED = "archived", "Archived"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="projects")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PROJECT)
    mode = models.CharField(max_length=12, choices=Mode.choices, default=Mode.PRIVATE)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    start_date = models.DateField(null=True, blank=True)
    deadline = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    sort_order = models.IntegerField(default=0)
    version = models.PositiveIntegerField(default=1)

    objects = ProjectManager()
    all_objects = models.Manager()

    class Meta:
        db_table = "projects_project"
        ordering = ["sort_order", "-created_at"]
        indexes = [
            models.Index(fields=["owner", "kind", "status"]),
            models.Index(fields=["owner", "-updated_at"]),
            models.Index(fields=["deadline"]),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def is_collaborative(self) -> bool:
        return self.mode in (self.Mode.GROUP, self.Mode.GROUP_PLUS)

    @property
    def supports_private_items(self) -> bool:
        return self.mode in (self.Mode.PRIVATE, self.Mode.GROUP_PLUS)


class ProjectMembership(TimeStampedModel):
    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        ADMIN = "admin", "Admin"
        MEMBER = "member", "Member"
        VIEWER = "viewer", "Viewer"

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="memberships")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="project_memberships", null=True, blank=True
    )
    invited_email = models.EmailField(blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    invited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="sent_invitations"
    )
    invite_token_hash = models.CharField(max_length=64, blank=True, db_index=True)
    invite_expires_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "projects_membership"
        constraints = [
            models.UniqueConstraint(
                fields=["project", "user"], name="uniq_project_user", condition=Q(user__isnull=False)
            ),
            models.UniqueConstraint(
                fields=["project", "invited_email"],
                name="uniq_project_invited_email",
                condition=Q(user__isnull=True) & ~Q(invited_email=""),
            ),
        ]
        indexes = [
            models.Index(fields=["user", "accepted_at"]),
            models.Index(fields=["project", "role"]),
        ]

    def __str__(self) -> str:
        return f"{self.project_id}:{self.user_id or self.invited_email}:{self.role}"

    @property
    def is_accepted(self) -> bool:
        return self.accepted_at is not None


class Idea(TimeStampedModel, SoftDeleteModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ideas")
    title = models.CharField(max_length=200)
    raw_text = models.TextField(blank=True)
    improved_text = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    category = models.CharField(max_length=60, blank=True)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    converted_project = models.ForeignKey(
        Project, on_delete=models.SET_NULL, null=True, blank=True, related_name="source_ideas"
    )
    converted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "projects_idea"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["owner", "-created_at"]),
            models.Index(fields=["owner", "category"]),
        ]

    def __str__(self) -> str:
        return self.title
