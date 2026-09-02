from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.collab.models import Comment
from apps.projects.models import Project
from apps.tasks.models import Task
from common.actors import Actor
from common.events import DomainEvent, EventName, emit
from common.exceptions import Forbidden, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import Capability, can_view_object, project_access

MAX_COMMENT_LENGTH = 5000


def _resolve_target(user, *, task_id: int | None, project_id: int | None) -> tuple[Task | None, Project | None]:
    if (task_id is None) == (project_id is None):
        raise ValidationFailed("Comment must target exactly one task or project.")
    if task_id is not None:
        task = Task.objects.select_related("project").filter(pk=task_id).first()
        if task is None or not can_view_object(
            user, owner_id=task.owner_id, project=task.project, visibility=task.visibility
        ):
            raise NotFound("Task not found.")
        return task, None
    project = Project.objects.filter(pk=project_id).first()
    if project is None or not project_access(user, project).can(Capability.VIEW):
        raise NotFound("Project not found.")
    return None, project


def _can_comment(user, task: Task | None, project: Project | None) -> bool:
    target_project = task.project if task is not None else project
    if target_project is None:
        return task is not None and task.owner_id == user.pk
    return project_access(user, target_project).can(Capability.COMMENT)


def _emit(comment: Comment, name: str, actor: Actor) -> None:
    task = comment.task
    project = comment.project or (task.project if task is not None else None)
    visibility = task.visibility if task is not None else Visibility.GROUP
    owner_id = task.owner_id if task is not None else project.owner_id if project else actor.user.pk
    emit(
        DomainEvent(
            name=name,
            actor=actor,
            target_type="task" if task is not None else "project",
            target_id=task.pk if task is not None else project.pk,
            owner_user_id=owner_id,
            project_id=project.pk if project is not None else None,
            visibility=visibility if project is not None else Visibility.PRIVATE,
            payload={
                "comment_id": comment.pk,
                "task_id": task.pk if task else None,
                "task_title": task.title if task else "",
                "project_name": project.name if project else "",
                "excerpt": comment.body[:140],
            },
        )
    )


@transaction.atomic
def create_comment(actor: Actor, *, body: str, task_id: int | None = None, project_id: int | None = None) -> Comment:
    body = (body or "").strip()
    if not body:
        raise ValidationFailed("Comment cannot be empty.", fields={"body": ["This field is required."]})
    if len(body) > MAX_COMMENT_LENGTH:
        raise ValidationFailed("Comment is too long.", fields={"body": [f"Max {MAX_COMMENT_LENGTH} characters."]})
    task, project = _resolve_target(actor.user, task_id=task_id, project_id=project_id)
    if not _can_comment(actor.user, task, project):
        raise Forbidden("You cannot comment here.")
    comment = Comment.objects.create(author=actor.user, task=task, project=project, body=body, source=actor.source)
    _emit(comment, EventName.COMMENT_CREATED, actor)
    return comment


@transaction.atomic
def update_comment(actor: Actor, comment_id: int, *, body: str) -> Comment:
    comment = Comment.objects.visible_to(actor.user).select_related("task", "project").filter(pk=comment_id).first()
    if comment is None:
        raise NotFound("Comment not found.")
    if comment.author_id != actor.user.pk:
        raise Forbidden("Only the author can edit a comment.")
    body = (body or "").strip()
    if not body:
        raise ValidationFailed("Comment cannot be empty.", fields={"body": ["This field is required."]})
    comment.body = body[:MAX_COMMENT_LENGTH]
    comment.edited_at = timezone.now()
    comment.save(update_fields=["body", "edited_at", "updated_at"])
    return comment


@transaction.atomic
def delete_comment(actor: Actor, comment_id: int) -> None:
    comment = Comment.objects.visible_to(actor.user).select_related("task", "project").filter(pk=comment_id).first()
    if comment is None:
        raise NotFound("Comment not found.")
    project = comment.project or (comment.task.project if comment.task_id else None)
    is_author = comment.author_id == actor.user.pk
    can_moderate = project is not None and project_access(actor.user, project).can(Capability.MANAGE_PROJECT)
    if not (is_author or can_moderate):
        raise Forbidden("You cannot delete this comment.")
    comment.soft_delete()
