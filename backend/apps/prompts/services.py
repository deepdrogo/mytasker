from __future__ import annotations

from django.conf import settings
from django.contrib.postgres.search import SearchVector
from django.db import transaction
from django.db.models import F
from django.utils.text import slugify

from apps.projects.models import Project
from apps.prompts.models import Prompt, PromptTag, PromptVersion
from common.actors import Actor
from common.events import DomainEvent, EventName, emit
from common.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import Capability, can_edit_object, can_view_object, project_access

EDITABLE = {"title", "body", "description", "category", "is_favorite", "is_archived"}


def get_prompt_for_user(prompt_id: int, user, *, for_update: bool = False) -> Prompt:
    qs = Prompt.objects.select_related("project", "owner", "created_by", "last_edited_by")
    if for_update:
        qs = qs.select_for_update(of=("self",))
    prompt = qs.filter(pk=prompt_id).first()
    if prompt is None or not can_view_object(
        user, owner_id=prompt.owner_id, project=prompt.project, visibility=prompt.visibility
    ):
        raise NotFound("Prompt not found.")
    return prompt


def _assert_edit(prompt: Prompt, user) -> None:
    if not can_edit_object(
        user,
        owner_id=prompt.owner_id,
        project=prompt.project,
        visibility=prompt.visibility,
        capability=Capability.EDIT_SHARED_PROMPTS,
    ):
        raise Forbidden("You cannot edit this prompt.")


def _update_search_vector(prompt: Prompt) -> None:
    Prompt.all_objects.filter(pk=prompt.pk).update(
        search_vector=SearchVector("title", weight="A")
        + SearchVector("description", weight="B")
        + SearchVector("category", weight="B")
        + SearchVector("body", weight="C")
    )


def _resolve_visibility(project: Project | None, requested: str | None, owner_is_actor: bool) -> str:
    if project is None:
        return Visibility.PRIVATE
    if project.mode == Project.Mode.PRIVATE:
        return Visibility.PRIVATE
    if requested == Visibility.PRIVATE and owner_is_actor and project.supports_private_items:
        return Visibility.PRIVATE
    return Visibility.GROUP


def _sync_tags(prompt: Prompt, names: list[str] | None) -> None:
    if names is None:
        return
    tags = []
    for raw in names[:20]:
        name = (raw or "").strip()[:40]
        if not name:
            continue
        slug = slugify(name)[:50] or name.lower()
        tag, _ = PromptTag.objects.get_or_create(owner=prompt.owner, slug=slug, defaults={"name": name})
        tags.append(tag)
    prompt.tags.set(tags)


def _payload(prompt: Prompt, **extra) -> dict:
    # Never include the prompt body in events - it may be private or huge.
    return {
        "prompt_id": prompt.pk,
        "title": prompt.title,
        "project_name": prompt.project.name if prompt.project_id else "",
        "visibility": prompt.visibility,
        **extra,
    }


def _emit(prompt: Prompt, name: str, actor: Actor, **extra) -> None:
    emit(
        DomainEvent(
            name=name,
            actor=actor,
            target_type="prompt",
            target_id=prompt.pk,
            owner_user_id=prompt.owner_id,
            project_id=prompt.project_id,
            visibility=prompt.visibility if prompt.project_id else Visibility.PRIVATE,
            payload=_payload(prompt, **extra),
        )
    )


@transaction.atomic
def create_prompt(
    actor: Actor,
    *,
    title: str,
    body: str,
    project_id: int | None = None,
    visibility: str | None = None,
    tags: list[str] | None = None,
    **fields,
) -> Prompt:
    user = actor.user
    title = (title or "").strip()
    if not title:
        raise ValidationFailed("Title is required.", fields={"title": ["This field is required."]})
    if not (body or "").strip():
        raise ValidationFailed("Prompt body is required.", fields={"body": ["This field is required."]})

    project = None
    if project_id is not None:
        project = Project.objects.filter(pk=project_id).first()
        if project is None:
            raise ValidationFailed("Project not found.", fields={"project": ["Unknown project."]})
        if not project_access(user, project).can(Capability.EDIT_SHARED_PROMPTS):
            raise Forbidden("You cannot add prompts to this project.")

    # Members own the prompts they create; visibility rules stay simple and enforceable.
    prompt = Prompt.objects.create(
        owner=user,
        created_by=user,
        last_edited_by=user,
        project=project,
        title=title,
        body=body,
        body_length=len(body),
        visibility=_resolve_visibility(project, visibility, True),
        **{k: v for k, v in fields.items() if k in EDITABLE - {"title", "body"}},
    )
    _sync_tags(prompt, tags)
    _update_search_vector(prompt)
    _emit(prompt, EventName.PROMPT_CREATED, actor)
    return prompt


@transaction.atomic
def update_prompt(
    actor: Actor,
    prompt_id: int,
    *,
    expected_version: int | None = None,
    project_id: int | None = ...,
    visibility: str | None = None,
    tags: list[str] | None = None,
    **fields,
) -> Prompt:
    user = actor.user
    prompt = get_prompt_for_user(prompt_id, user, for_update=True)
    _assert_edit(prompt, user)
    if expected_version is not None and expected_version != prompt.version:
        raise Conflict(
            "This prompt was changed elsewhere. Reload to see the latest version.", code="version_conflict"
        )

    changed: list[str] = []
    content_changed = False

    new_title = fields.get("title", prompt.title)
    new_body = fields.get("body", prompt.body)
    if "title" in fields:
        new_title = (new_title or "").strip()
        if not new_title:
            raise ValidationFailed("Title is required.", fields={"title": ["This field is required."]})
    if "body" in fields and not (new_body or "").strip():
        raise ValidationFailed("Prompt body is required.", fields={"body": ["This field is required."]})

    if new_title != prompt.title or new_body != prompt.body:
        # Snapshot the previous state exactly once per real change.
        PromptVersion.objects.create(
            prompt=prompt,
            number=prompt.version,
            title=prompt.title,
            body=prompt.body,
            description=prompt.description,
            edited_by=prompt.last_edited_by,
        )
        content_changed = True
        prompt.title = new_title
        prompt.body = new_body
        prompt.body_length = len(new_body)
        changed += ["title", "body", "body_length"]

    for key in ("description", "category", "is_favorite", "is_archived"):
        if key in fields and getattr(prompt, key) != fields[key]:
            setattr(prompt, key, fields[key])
            changed.append(key)

    if project_id is not ...:
        if prompt.owner_id != user.pk:
            raise Forbidden("Only the owner can move a prompt.")
        project = None
        if project_id is not None:
            project = Project.objects.filter(pk=project_id).first()
            if project is None or not project_access(user, project).can(Capability.EDIT_SHARED_PROMPTS):
                raise ValidationFailed("Project not found.", fields={"project": ["Unknown project."]})
        prompt.project = project
        prompt.visibility = _resolve_visibility(project, visibility or prompt.visibility, True)
        changed += ["project", "visibility"]
    elif visibility is not None:
        if prompt.owner_id != user.pk:
            raise Forbidden("Only the owner can change visibility.")
        new_visibility = _resolve_visibility(prompt.project, visibility, True)
        if new_visibility != prompt.visibility:
            prompt.visibility = new_visibility
            changed.append("visibility")

    _sync_tags(prompt, tags)

    if not changed and tags is None:
        return prompt

    if changed:
        prompt.last_edited_by = user
        if content_changed:
            prompt.version = F("version") + 1
        prompt.save(update_fields=[*set(changed), "last_edited_by", "version", "updated_at"])
        prompt.refresh_from_db()
        if content_changed or "description" in changed or "category" in changed:
            _update_search_vector(prompt)

    if "visibility" in changed:
        _emit(prompt, EventName.PROMPT_VISIBILITY_CHANGED, actor)
    elif content_changed:
        _emit(prompt, EventName.PROMPT_UPDATED, actor, version=prompt.version)
    return prompt


@transaction.atomic
def delete_prompt(actor: Actor, prompt_id: int) -> None:
    prompt = get_prompt_for_user(prompt_id, actor.user, for_update=True)
    if prompt.owner_id != actor.user.pk:
        _assert_edit(prompt, actor.user)
    prompt.soft_delete()
    _emit(prompt, EventName.PROMPT_DELETED, actor)


@transaction.atomic
def duplicate_prompt(actor: Actor, prompt_id: int) -> Prompt:
    original = get_prompt_for_user(prompt_id, actor.user)
    project = (
        original.project if original.project_id and project_access(actor.user, original.project).is_member else None
    )
    copy = Prompt.objects.create(
        owner=actor.user,
        created_by=actor.user,
        last_edited_by=actor.user,
        project=project,
        title=f"{original.title} (copy)"[:250],
        body=original.body,
        body_length=original.body_length,
        description=original.description,
        category=original.category,
        visibility=Visibility.PRIVATE,
    )
    copy.tags.set(original.tags.filter(owner=actor.user))
    _update_search_vector(copy)
    _emit(copy, EventName.PROMPT_CREATED, actor, duplicated_from=original.pk)
    return copy


@transaction.atomic
def restore_version(actor: Actor, prompt_id: int, version_number: int) -> Prompt:
    prompt = get_prompt_for_user(prompt_id, actor.user, for_update=True)
    _assert_edit(prompt, actor.user)
    version = PromptVersion.objects.filter(prompt=prompt, number=version_number).first()
    if version is None:
        raise NotFound("Version not found.")
    return update_prompt(actor, prompt_id, title=version.title, body=version.body, description=version.description)


def snippet_length() -> int:
    return int(getattr(settings, "PROMPT_SNIPPET_LENGTH", 200))
