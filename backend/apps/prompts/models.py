from __future__ import annotations

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from django.db.models import Q

from common.models import SoftDeleteManager, SoftDeleteModel, SoftDeleteQuerySet, TimeStampedModel, Visibility


class PromptTag(TimeStampedModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="prompt_tags")
    name = models.CharField(max_length=40)
    slug = models.SlugField(max_length=50)

    class Meta:
        db_table = "prompts_tag"
        constraints = [models.UniqueConstraint(fields=["owner", "slug"], name="uniq_prompt_tag_owner_slug")]
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class PromptQuerySet(SoftDeleteQuerySet):
    def visible_to(self, user):
        """
        Prompt visibility - the only place this rule exists.

        - owner sees all their prompts (private and group)
        - project members see prompts with visibility=group belonging to a group/group_plus project
        - private prompts of other users are never returned (Group Plus safety)
        """
        if user is None or not getattr(user, "is_authenticated", False):
            return self.none()
        if getattr(user, "assistant_for_id", None) is not None:
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

    def active(self):
        return self.filter(is_archived=False)


class PromptManager(SoftDeleteManager):
    def get_queryset(self):
        return PromptQuerySet(self.model, using=self._db).alive()

    def visible_to(self, user):
        return self.get_queryset().visible_to(user)


class Prompt(TimeStampedModel, SoftDeleteModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="prompts")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="created_prompts"
    )
    last_edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="edited_prompts"
    )
    project = models.ForeignKey(
        "projects.Project", on_delete=models.SET_NULL, null=True, blank=True, related_name="prompts"
    )

    title = models.CharField(max_length=250)
    body = models.TextField()  # may be very large; never truncated
    description = models.TextField(blank=True)
    category = models.CharField(max_length=60, blank=True)
    tags = models.ManyToManyField(PromptTag, blank=True, related_name="prompts")

    visibility = models.CharField(max_length=10, choices=Visibility.choices, default=Visibility.PRIVATE)
    is_favorite = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)

    version = models.PositiveIntegerField(default=1)
    body_length = models.PositiveIntegerField(default=0)
    search_vector = SearchVectorField(null=True, editable=False)

    objects = PromptManager()
    all_objects = models.Manager()

    class Meta:
        db_table = "prompts_prompt"
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["owner", "-updated_at"], name="prompt_owner_updated"),
            models.Index(fields=["owner", "is_favorite", "-updated_at"], name="prompt_owner_fav"),
            models.Index(fields=["project", "-updated_at"], name="prompt_project_updated"),
            models.Index(fields=["owner", "category"], name="prompt_owner_category"),
            GinIndex(fields=["search_vector"], name="prompt_search_vector_gin"),
            GinIndex(fields=["title"], name="prompt_title_trgm", opclasses=["gin_trgm_ops"]),
        ]

    def __str__(self) -> str:
        return self.title

    def snippet(self, length: int = 200) -> str:
        text = self.body[: length + 1]
        return text[:length] + ("…" if len(self.body) > length else "")


class PromptVersion(models.Model):
    """
    Snapshot of a prompt's content *before* an edit. Created only on explicit save operations where
    title or body actually changed - never per keystroke.
    """

    prompt = models.ForeignKey(Prompt, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    title = models.CharField(max_length=250)
    body = models.TextField()
    description = models.TextField(blank=True)
    edited_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="prompt_versions"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "prompts_version"
        ordering = ["-number"]
        constraints = [models.UniqueConstraint(fields=["prompt", "number"], name="uniq_prompt_version_number")]
        indexes = [models.Index(fields=["prompt", "-number"], name="prompt_version_lookup")]

    def __str__(self) -> str:
        return f"{self.prompt_id} v{self.number}"

    def snippet(self, length: int = 200) -> str:
        return self.body[:length] + ("…" if len(self.body) > length else "")
