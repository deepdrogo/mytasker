"""
Registry of translatable content.

Each spec declares the model, the user-written text fields, how to scope a queryset to what a
user may see (always through the model's `visible_to` / ownership rule - no second implementation)
and who should receive realtime "translation ready" pushes.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from django.db.models import Model, QuerySet

from common.models import Visibility

# Per-field ceiling; longer values are left untranslated so a single object cannot burn a huge budget.
MAX_FIELD_CHARS = 6000


@dataclass(frozen=True)
class Audience:
    user_ids: tuple[int, ...]
    project_id: int | None = None  # set only when the payload may go to the whole project group


@dataclass(frozen=True)
class Translatable:
    type: str
    model_path: str  # "app_label.ModelName"
    fields: tuple[str, ...]
    # Scope a queryset of this model to what `user` may see.
    visible_to: Callable[[Any, QuerySet], QuerySet]
    audience: Callable[[Model], Audience]

    def model(self) -> type[Model]:
        from django.apps import apps

        return apps.get_model(self.model_path)

    def queryset(self) -> QuerySet:
        return self.model().objects.all()

    def visible_queryset(self, user) -> QuerySet:
        return self.visible_to(user, self.queryset())


def _visible_manager(user, qs: QuerySet) -> QuerySet:
    return qs.model.objects.visible_to(user)


def _owner_only(user, qs: QuerySet) -> QuerySet:
    return qs.filter(owner=user)


def _routine_owner_only(user, qs: QuerySet) -> QuerySet:
    return qs.filter(routine__owner=user, routine__deleted_at__isnull=True)


def _task_audience(task) -> Audience:
    users = {task.owner_id}
    if task.assignee_id:
        users.add(task.assignee_id)
    project_id = task.project_id if task.project_id and task.visibility == Visibility.GROUP else None
    return Audience(tuple(users), project_id)


def _project_audience(project) -> Audience:
    return Audience((project.owner_id,), project.pk)


def _prompt_audience(prompt) -> Audience:
    project_id = prompt.project_id if prompt.project_id and prompt.visibility == Visibility.GROUP else None
    return Audience((prompt.owner_id,), project_id)


def _comment_audience(comment) -> Audience:
    users = {comment.author_id}
    project_id = None
    if comment.task_id is not None:
        task = comment.task
        users.add(task.owner_id)
        if task.project_id and task.visibility == Visibility.GROUP:
            project_id = task.project_id
    elif comment.project_id is not None:
        project_id = comment.project_id
    return Audience(tuple(users), project_id)


def _owner_audience(obj) -> Audience:
    return Audience((obj.owner_id,))


def _routine_item_audience(item) -> Audience:
    return Audience((item.routine.owner_id,))


REGISTRY: dict[str, Translatable] = {
    spec.type: spec
    for spec in (
        Translatable(
            type="task",
            model_path="tasks.Task",
            fields=("title", "description", "notes"),
            visible_to=_visible_manager,
            audience=_task_audience,
        ),
        Translatable(
            type="project",
            model_path="projects.Project",
            fields=("name", "description", "notes"),
            visible_to=_visible_manager,
            audience=_project_audience,
        ),
        Translatable(
            type="idea",
            model_path="projects.Idea",
            fields=("title", "raw_text", "improved_text", "notes", "category"),
            visible_to=_owner_only,
            audience=_owner_audience,
        ),
        # Prompt bodies are instructions for an LLM; translating them would change what they do.
        Translatable(
            type="prompt",
            model_path="prompts.Prompt",
            fields=("title", "description", "category"),
            visible_to=_visible_manager,
            audience=_prompt_audience,
        ),
        Translatable(
            type="comment",
            model_path="collab.Comment",
            fields=("body",),
            visible_to=_visible_manager,
            audience=_comment_audience,
        ),
        Translatable(
            type="routine_item",
            model_path="routines.RoutineItem",
            fields=("name", "description"),
            visible_to=_routine_owner_only,
            audience=_routine_item_audience,
        ),
        Translatable(
            type="rule",
            model_path="routines.Rule",
            fields=("text", "description"),
            visible_to=_owner_only,
            audience=_owner_audience,
        ),
    )
}


def get_spec(target_type: str) -> Translatable | None:
    return REGISTRY.get(target_type)


def select_related_for(spec: Translatable) -> tuple[str, ...]:
    if spec.type == "comment":
        return ("task",)
    if spec.type == "routine_item":
        return ("routine",)
    return ()
