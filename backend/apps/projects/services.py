from __future__ import annotations

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from apps.projects.models import Idea, Project, ProjectMembership
from common.actors import Actor
from common.events import DomainEvent, EventName, emit
from common.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from common.models import Visibility
from common.permissions import Capability, project_access

INVITE_TTL = timedelta(days=7)

PROJECT_FIELDS = {
    "name",
    "description",
    "kind",
    "status",
    "priority",
    "start_date",
    "deadline",
    "notes",
    "sort_order",
}


def get_project_for_user(project_id: int, user, *, capability: str = Capability.VIEW, for_update: bool = False):
    qs = Project.objects.select_related("owner")
    if for_update:
        qs = qs.select_for_update(of=("self",))
    project = qs.filter(pk=project_id).first()
    if project is None:
        raise NotFound("Project not found.")
    access = project_access(user, project)
    if not access.is_member:
        raise NotFound("Project not found.")
    if not access.can(capability):
        raise Forbidden("You do not have permission for this action.")
    return project


def _event(project: Project, name: str, actor: Actor, **payload) -> None:
    emit(
        DomainEvent(
            name=name,
            actor=actor,
            target_type="project",
            target_id=project.pk,
            owner_user_id=project.owner_id,
            project_id=project.pk,
            visibility=Visibility.GROUP,
            payload={"project_id": project.pk, "project_name": project.name, **payload},
        )
    )


@transaction.atomic
def create_project(actor: Actor, *, name: str, mode: str = Project.Mode.PRIVATE, **fields) -> Project:
    name = (name or "").strip()
    if not name:
        raise ValidationFailed("Name is required.", fields={"name": ["This field is required."]})
    payload = {k: v for k, v in fields.items() if k in PROJECT_FIELDS}
    project = Project.objects.create(owner=actor.user, name=name, mode=mode, **payload)
    ProjectMembership.objects.create(
        project=project, user=actor.user, role=ProjectMembership.Role.OWNER, accepted_at=timezone.now()
    )
    _event(project, EventName.PROJECT_CREATED, actor, mode=mode)
    return project


@transaction.atomic
def update_project(actor: Actor, project_id: int, *, expected_version: int | None = None, **fields) -> Project:
    project = get_project_for_user(project_id, actor.user, capability=Capability.MANAGE_PROJECT, for_update=True)
    if expected_version is not None and expected_version != project.version:
        raise Conflict("Project changed elsewhere. Reload and try again.", code="version_conflict")

    changed = []
    for key, value in fields.items():
        if key not in PROJECT_FIELDS:
            continue
        if key == "name":
            value = (value or "").strip()
            if not value:
                raise ValidationFailed("Name is required.", fields={"name": ["This field is required."]})
        setattr(project, key, value)
        changed.append(key)
    if not changed:
        return project
    project.version = F("version") + 1
    project.save(update_fields=[*changed, "version", "updated_at"])
    project.refresh_from_db()
    _event(project, EventName.PROJECT_UPDATED, actor, fields=sorted(changed))
    return project


@transaction.atomic
def change_mode(actor: Actor, project_id: int, *, mode: str) -> Project:
    """
    Mode transitions (all inside one transaction so visibility never ends up half-migrated):

      private    -> group/group_plus : existing items become group-visible for the new team
      group      -> group_plus       : nothing changes; the owner may now mark items private
      group_plus -> group            : plain Group has no private items, so the owner's private items
                                       are flipped to group visibility (the UI confirms this first)
      any        -> private          : memberships are kept but ignored; every item is owner-only again
    """
    project = get_project_for_user(project_id, actor.user, capability=Capability.CHANGE_MODE, for_update=True)
    if mode not in dict(Project.Mode.choices):
        raise ValidationFailed("Unknown mode.", fields={"mode": ["Invalid."]})
    if project.mode == mode:
        return project

    from apps.prompts.models import Prompt
    from apps.tasks.models import Task

    previous = project.mode
    project.mode = mode
    project.version = F("version") + 1
    project.save(update_fields=["mode", "version", "updated_at"])
    project.refresh_from_db()

    if mode == Project.Mode.GROUP:
        # Plain group has no private items; the owner keeps ownership so nothing leaks beyond the team.
        Task.all_objects.filter(project=project, owner=project.owner, visibility=Visibility.PRIVATE).update(
            visibility=Visibility.GROUP
        )
        Prompt.all_objects.filter(project=project, owner=project.owner, visibility=Visibility.PRIVATE).update(
            visibility=Visibility.GROUP
        )
    elif mode == Project.Mode.PRIVATE:
        Task.all_objects.filter(project=project).update(visibility=Visibility.PRIVATE)
        Prompt.all_objects.filter(project=project).update(visibility=Visibility.PRIVATE)
    elif previous == Project.Mode.PRIVATE:
        # Opening a private project: items become group visible for the new team.
        Task.all_objects.filter(project=project).update(visibility=Visibility.GROUP)
        Prompt.all_objects.filter(project=project).update(visibility=Visibility.GROUP)

    _event(project, EventName.PROJECT_MODE_CHANGED, actor, previous_mode=previous, mode=mode)
    return project


@transaction.atomic
def delete_project(actor: Actor, project_id: int) -> None:
    project = get_project_for_user(project_id, actor.user, capability=Capability.DELETE_PROJECT, for_update=True)
    from apps.tasks.models import Task

    now = timezone.now()
    Task.objects.filter(project=project).update(deleted_at=now)
    project.deleted_at = now
    project.save(update_fields=["deleted_at"])


# ----------------------------------------------------------------------------- members


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


@transaction.atomic
def invite_member(actor: Actor, project_id: int, *, email: str, role: str) -> tuple[ProjectMembership, str | None]:
    project = get_project_for_user(project_id, actor.user, capability=Capability.MANAGE_MEMBERS, for_update=True)
    if not project.is_collaborative:
        raise ValidationFailed("Switch the project to Group or Group Plus before inviting members.")
    if role not in (ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER):
        raise ValidationFailed("Invalid role.", fields={"role": ["Choose admin, member or viewer."]})

    email = email.strip().lower()
    from apps.accounts.models import User

    existing_user = User.objects.filter(email=email).first()
    if existing_user is not None and existing_user.pk == project.owner_id:
        raise ValidationFailed("The owner is already part of the project.")

    membership = (
        ProjectMembership.objects.filter(project=project).filter(_member_lookup(existing_user, email)).first()
    )
    if membership is not None and membership.accepted_at is not None:
        raise Conflict("This person is already a member.")

    token = secrets.token_urlsafe(32)
    if membership is None:
        membership = ProjectMembership(project=project, invited_by=actor.user)
    membership.user = existing_user
    membership.invited_email = email
    membership.role = role
    membership.invite_token_hash = _hash(token)
    membership.invite_expires_at = timezone.now() + INVITE_TTL
    membership.accepted_at = None
    membership.save()

    url = f"{settings.SITE_URL}/projects/join?token={token}"
    send_mail(
        subject=f"{actor.display_name} invited you to {project.name} on MyTasker",
        message=f"Join the project:\n\n{url}\n\nThe invitation expires in 7 days.",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
        fail_silently=True,
    )
    _event(project, EventName.PROJECT_MEMBER_INVITED, actor, email=email, role=role)
    return membership, token


def _member_lookup(user, email):
    from django.db.models import Q

    if user is not None:
        return Q(user=user) | Q(invited_email=email)
    return Q(invited_email=email)


@transaction.atomic
def accept_invitation(actor: Actor, *, token: str) -> ProjectMembership:
    membership = (
        ProjectMembership.objects.select_for_update()
        .select_related("project")
        .filter(invite_token_hash=_hash(token), accepted_at__isnull=True)
        .first()
    )
    if membership is None or (membership.invite_expires_at and membership.invite_expires_at < timezone.now()):
        raise ValidationFailed("This invitation is invalid or has expired.")
    if membership.user_id and membership.user_id != actor.user.pk:
        raise Forbidden("This invitation was sent to a different account.")
    if membership.invited_email and membership.invited_email != actor.user.email.lower():
        raise Forbidden("Sign in with the invited email address to accept.")

    # Someone may have been added directly meanwhile.
    ProjectMembership.objects.filter(project=membership.project, user=actor.user).exclude(pk=membership.pk).delete()

    membership.user = actor.user
    membership.accepted_at = timezone.now()
    membership.invite_token_hash = ""
    membership.save(update_fields=["user", "accepted_at", "invite_token_hash", "updated_at"])
    _event(
        membership.project,
        EventName.PROJECT_MEMBER_JOINED,
        actor,
        member=actor.display_name,
        role=membership.role,
    )
    return membership


@transaction.atomic
def change_role(actor: Actor, project_id: int, membership_id: int, *, role: str) -> ProjectMembership:
    project = get_project_for_user(project_id, actor.user, capability=Capability.MANAGE_MEMBERS)
    membership = ProjectMembership.objects.select_related("user").filter(pk=membership_id, project=project).first()
    if membership is None:
        raise NotFound("Member not found.")
    if membership.role == ProjectMembership.Role.OWNER or membership.user_id == project.owner_id:
        raise Forbidden("The owner role cannot be changed.")
    if role not in (ProjectMembership.Role.ADMIN, ProjectMembership.Role.MEMBER, ProjectMembership.Role.VIEWER):
        raise ValidationFailed("Invalid role.")
    access = project_access(actor.user, project)
    if not access.is_owner and role == ProjectMembership.Role.ADMIN:
        raise Forbidden("Only the owner can promote admins.")
    membership.role = role
    membership.save(update_fields=["role", "updated_at"])
    _event(
        project,
        EventName.PROJECT_MEMBER_ROLE_CHANGED,
        actor,
        member=membership.user.display_name if membership.user else membership.invited_email,
        role=role,
    )
    return membership


@transaction.atomic
def remove_member(actor: Actor, project_id: int, membership_id: int) -> None:
    project = get_project_for_user(project_id, actor.user, capability=Capability.VIEW)
    membership = ProjectMembership.objects.select_related("user").filter(pk=membership_id, project=project).first()
    if membership is None:
        raise NotFound("Member not found.")
    if membership.user_id == project.owner_id:
        raise Forbidden("The owner cannot be removed.")
    is_self = membership.user_id == actor.user.pk
    if not is_self and not project_access(actor.user, project).can(Capability.MANAGE_MEMBERS):
        raise Forbidden("You cannot remove members.")
    name = membership.user.display_name if membership.user else membership.invited_email
    membership.delete()
    _event(project, EventName.PROJECT_MEMBER_REMOVED, actor, member=name, left=is_self)


# ------------------------------------------------------------------------------- ideas


IDEA_FIELDS = {"title", "raw_text", "improved_text", "notes", "category", "priority"}


@transaction.atomic
def create_idea(actor: Actor, *, title: str, **fields) -> Idea:
    title = (title or "").strip()
    if not title:
        raise ValidationFailed("Title is required.", fields={"title": ["This field is required."]})
    idea = Idea.objects.create(owner=actor.user, title=title, **{k: v for k, v in fields.items() if k in IDEA_FIELDS})
    emit(
        DomainEvent(
            name=EventName.IDEA_CREATED,
            actor=actor,
            target_type="idea",
            target_id=idea.pk,
            owner_user_id=actor.user.pk,
            visibility=Visibility.PRIVATE,
            payload={"idea_id": idea.pk, "title": idea.title},
        )
    )
    return idea


@transaction.atomic
def update_idea(actor: Actor, idea_id: int, **fields) -> Idea:
    idea = Idea.objects.filter(pk=idea_id, owner=actor.user).first()
    if idea is None:
        raise NotFound("Idea not found.")
    changed = []
    for key, value in fields.items():
        if key in IDEA_FIELDS:
            setattr(idea, key, value)
            changed.append(key)
    if changed:
        idea.save(update_fields=[*changed, "updated_at"])
        from apps.translations.services import request_translation

        request_translation("idea", idea.pk)
    return idea


@transaction.atomic
def delete_idea(actor: Actor, idea_id: int) -> None:
    idea = Idea.objects.filter(pk=idea_id, owner=actor.user).first()
    if idea is None:
        raise NotFound("Idea not found.")
    idea.soft_delete()


@transaction.atomic
def convert_idea(actor: Actor, idea_id: int, *, kind: str = Project.Kind.PROJECT) -> Project:
    idea = Idea.objects.select_for_update().filter(pk=idea_id, owner=actor.user).first()
    if idea is None:
        raise NotFound("Idea not found.")
    if idea.converted_project_id:
        raise Conflict("This idea was already converted.")
    project = create_project(
        actor,
        name=idea.title,
        description=idea.improved_text or idea.raw_text,
        kind=kind,
        priority=idea.priority,
        status=Project.Status.PLANNED,
        notes=idea.notes,
    )
    idea.converted_project = project
    idea.converted_at = timezone.now()
    idea.save(update_fields=["converted_project", "converted_at", "updated_at"])
    emit(
        DomainEvent(
            name=EventName.IDEA_CONVERTED,
            actor=actor,
            target_type="idea",
            target_id=idea.pk,
            owner_user_id=actor.user.pk,
            project_id=project.pk,
            visibility=Visibility.PRIVATE,
            payload={"idea_id": idea.pk, "title": idea.title, "project_id": project.pk},
        )
    )
    return project
