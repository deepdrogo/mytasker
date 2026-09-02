from __future__ import annotations

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from django.db.models import Q

from common.models import (
    Priority,
    SoftDeleteManager,
    SoftDeleteModel,
    SoftDeleteQuerySet,
    Source,
    TimeStampedModel,
    Visibility,
)


class RecurrenceRule(TimeStampedModel):
    class Freq(models.TextChoices):
        DAILY = "daily", "Daily"
        WEEKDAYS = "weekdays", "Weekdays"
        WEEKLY = "weekly", "Weekly"
        MONTHLY = "monthly", "Monthly"
        CUSTOM = "custom", "Custom"

    freq = models.CharField(max_length=10, choices=Freq.choices)
    interval = models.PositiveSmallIntegerField(default=1)
    byweekday = ArrayField(models.PositiveSmallIntegerField(), default=list, blank=True)  # 0=Mon .. 6=Sun
    bymonthday = models.PositiveSmallIntegerField(null=True, blank=True)
    until = models.DateField(null=True, blank=True)
    count = models.PositiveIntegerField(null=True, blank=True)
    occurrences_created = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "tasks_recurrence_rule"

    def __str__(self) -> str:
        return f"{self.freq}/{self.interval}"


class TaskQuerySet(SoftDeleteQuerySet):
    def visible_to(self, user):
        """
        Single source of truth for task visibility.

        - own tasks: always
        - project tasks: accepted member of a group / group_plus project AND visibility=group
        - private (Group Plus) tasks of other users: never
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        from apps.projects.models import Project

        return self.filter(
            Q(owner=user)
            | Q(
                visibility=Visibility.GROUP,
                project__isnull=False,
                project__deleted_at__isnull=True,
                project__mode__in=[Project.Mode.GROUP, Project.Mode.GROUP_PLUS],
                project__memberships__user=user,
                project__memberships__accepted_at__isnull=False,
            )
        ).distinct()

    def top_level(self):
        return self.filter(parent__isnull=True)

    def open(self):
        return self.exclude(status__in=[Task.Status.DONE, Task.Status.CANCELLED])

    def completed(self):
        return self.filter(status=Task.Status.DONE)


class TaskManager(SoftDeleteManager):
    def get_queryset(self):
        return TaskQuerySet(self.model, using=self._db).alive()

    def visible_to(self, user):
        return self.get_queryset().visible_to(user)


class Task(TimeStampedModel, SoftDeleteModel):
    """
    Unified task model. A subtask is a Task with `parent` set (max depth 1, enforced in the service
    layer and by a DB check on `depth`).
    """

    class Kind(models.TextChoices):
        PERSONAL = "personal", "Personal"
        BUSINESS = "business", "Business"

    class Status(models.TextChoices):
        TODO = "todo", "To do"
        IN_PROGRESS = "in_progress", "In progress"
        DONE = "done", "Done"
        CANCELLED = "cancelled", "Cancelled"

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="tasks")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_tasks"
    )
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="assigned_tasks"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.CASCADE, null=True, blank=True, related_name="tasks"
    )
    parent = models.ForeignKey("self", on_delete=models.CASCADE, null=True, blank=True, related_name="subtasks")
    depth = models.PositiveSmallIntegerField(default=0)

    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.PERSONAL, db_index=True)
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.TODO)
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.GROUP)

    start_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    due_has_time = models.BooleanField(default=False)
    reminder_at = models.DateTimeField(null=True, blank=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)

    recurrence = models.ForeignKey(
        RecurrenceRule, on_delete=models.SET_NULL, null=True, blank=True, related_name="tasks"
    )
    recurrence_parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="recurrence_children"
    )

    tags = ArrayField(models.CharField(max_length=40), default=list, blank=True)
    sort_order = models.IntegerField(default=0)
    version = models.PositiveIntegerField(default=1)

    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_tasks"
    )
    completed_by_guest = models.ForeignKey(
        "sharing.ShareGuestSession", on_delete=models.SET_NULL, null=True, blank=True, related_name="completed_tasks"
    )
    completion_source = models.CharField(max_length=20, choices=Source.choices, blank=True)

    search_vector = SearchVectorField(null=True, editable=False)

    objects = TaskManager()
    all_objects = models.Manager()

    class Meta:
        db_table = "tasks_task"
        ordering = ["sort_order", "-created_at"]
        indexes = [
            models.Index(fields=["owner", "kind", "status", "due_at"], name="task_owner_kind_status_due"),
            models.Index(fields=["project", "status"], name="task_project_status"),
            models.Index(fields=["assignee", "status"], name="task_assignee_status"),
            models.Index(fields=["parent"], name="task_parent"),
            models.Index(fields=["owner", "-completed_at"], name="task_owner_completed"),
            GinIndex(fields=["title"], name="task_title_trgm", opclasses=["gin_trgm_ops"]),
            models.Index(
                fields=["owner", "due_at"],
                name="task_owner_due_open",
                condition=Q(completed_at__isnull=True, deleted_at__isnull=True),
            ),
            models.Index(
                fields=["reminder_at"],
                name="task_reminder_pending",
                condition=Q(reminder_at__isnull=False, reminder_sent_at__isnull=True),
            ),
            GinIndex(fields=["search_vector"], name="task_search_vector_gin"),
            GinIndex(fields=["tags"], name="task_tags_gin"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(depth__lte=1), name="task_max_depth"),
            models.CheckConstraint(
                condition=Q(parent__isnull=True) | Q(depth=1),
                name="task_subtask_depth_consistent",
            ),
        ]

    def __str__(self) -> str:
        return self.title

    @property
    def is_subtask(self) -> bool:
        return self.parent_id is not None

    @property
    def is_done(self) -> bool:
        return self.status == self.Status.DONE

    @property
    def is_overdue(self) -> bool:
        from django.utils import timezone

        return bool(self.due_at and not self.is_done and self.due_at < timezone.now())


class Reminder(TimeStampedModel):
    """Explicit reminder rows for tasks and routine items; scanned by Celery beat every minute."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SENT = "sent", "Sent"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reminders")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, null=True, blank=True, related_name="reminders")
    remind_at = models.DateTimeField()
    message = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "tasks_reminder"
        indexes = [
            models.Index(fields=["remind_at", "status"], name="reminder_due"),
            models.Index(fields=["user", "status"], name="reminder_user_status"),
        ]
