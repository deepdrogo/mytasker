from __future__ import annotations

from django.conf import settings
from django.db import models
from django.db.models import Q

from common.actors import ActorKind
from common.models import SoftDeleteManager, SoftDeleteModel, SoftDeleteQuerySet, Source, TimeStampedModel, Visibility

ACTOR_KIND_CHOICES = [
    (ActorKind.USER, "User"),
    (ActorKind.GUEST, "Guest"),
    (ActorKind.AI, "AI"),
    (ActorKind.TELEGRAM, "Telegram"),
    (ActorKind.SYSTEM, "System"),
]


class CommentQuerySet(SoftDeleteQuerySet):
    def visible_to(self, user):
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        from apps.projects.models import Project

        member_projects = Q(
            project__isnull=False,
            project__deleted_at__isnull=True,
            project__mode__in=[Project.Mode.GROUP, Project.Mode.GROUP_PLUS],
            project__memberships__user=user,
            project__memberships__accepted_at__isnull=False,
        )
        return self.filter(
            Q(author=user)
            | Q(project__owner=user)
            | (member_projects & (Q(task__isnull=True) | Q(task__visibility=Visibility.GROUP)))
        ).distinct()


class CommentManager(SoftDeleteManager):
    def get_queryset(self):
        return CommentQuerySet(self.model, using=self._db).alive()

    def visible_to(self, user):
        return self.get_queryset().visible_to(user)


class Comment(TimeStampedModel, SoftDeleteModel):
    """Comment on exactly one of: task, project."""

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="comments")
    task = models.ForeignKey("tasks.Task", on_delete=models.CASCADE, null=True, blank=True, related_name="comments")
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="comments"
    )
    body = models.TextField()
    edited_at = models.DateTimeField(null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)

    objects = CommentManager()
    all_objects = models.Manager()

    class Meta:
        db_table = "collab_comment"
        ordering = ["created_at"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(task__isnull=False) & Q(project__isnull=True))
                | (Q(task__isnull=True) & Q(project__isnull=False)),
                name="comment_single_target",
            )
        ]
        indexes = [
            models.Index(fields=["task", "created_at"], name="comment_task"),
            models.Index(fields=["project", "created_at"], name="comment_project"),
        ]

    def __str__(self) -> str:
        return f"Comment({self.pk})"


class ActivityEventQuerySet(models.QuerySet):
    def visible_to(self, user):
        """
        Activity visibility mirrors object visibility: personal events only for their owner,
        project events for members, private (Group Plus) events only for the project owner.
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        from apps.projects.models import Project

        return self.filter(
            Q(owner_user=user)
            | Q(
                visibility=Visibility.GROUP,
                project__isnull=False,
                project__deleted_at__isnull=True,
                project__mode__in=[Project.Mode.GROUP, Project.Mode.GROUP_PLUS],
                project__memberships__user=user,
                project__memberships__accepted_at__isnull=False,
            )
        ).distinct()

    def feed(self):
        return self.filter(in_feed=True)


class ActivityEvent(models.Model):
    """
    Persisted domain event. Written inside the same transaction as the mutation; the notification
    fan-out and realtime publishing read from here after commit.
    """

    name = models.CharField(max_length=50, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    owner_user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="owned_activity")
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="activity"
    )

    actor_kind = models.CharField(max_length=10, choices=ACTOR_KIND_CHOICES, default=ActorKind.USER)
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="actor_activity"
    )
    actor_guest = models.ForeignKey(
        "sharing.ShareGuestSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="activity"
    )
    actor_display = models.CharField(max_length=120, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.WEB)

    target_type = models.CharField(max_length=30)
    target_id = models.BigIntegerField()
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.GROUP)
    in_feed = models.BooleanField(default=True)
    payload = models.JSONField(default=dict, blank=True)

    objects = ActivityEventQuerySet.as_manager()

    class Meta:
        db_table = "collab_activity_event"
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["project", "-id"], name="activity_project"),
            models.Index(fields=["owner_user", "-id"], name="activity_owner"),
            models.Index(fields=["target_type", "target_id"], name="activity_target"),
            models.Index(fields=["name", "-id"], name="activity_name"),
        ]

    def __str__(self) -> str:
        return f"{self.name}#{self.pk}"
