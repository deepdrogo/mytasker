"""
Object-level authorization. The single source of truth for "who may do what" on projects,
tasks, prompts and comments. Views, AI tools, Telegram handlers and WebSocket publishers all
call into this module; nothing else decides permissions.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from common.models import Visibility

if TYPE_CHECKING:
    from apps.accounts.models import User
    from apps.projects.models import Project


class Role:
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"
    # Not a membership role: derived from `User.assistant_for`. Has an explicit capability set
    # (ASSISTANT_CAPABILITIES) instead of a position in ORDER.
    ASSISTANT = "assistant"

    ORDER = {OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3}

    @classmethod
    def at_least(cls, role: str | None, minimum: str) -> bool:
        if role is None or role not in cls.ORDER:
            return False
        return cls.ORDER[role] <= cls.ORDER[minimum]


class Capability:
    VIEW = "view"
    CREATE_TASK = "create_task"
    EDIT_TASK = "edit_task"
    COMPLETE_TASK = "complete_task"
    DELETE_TASK = "delete_task"
    COMMENT = "comment"
    TRACK_TIME = "track_time"
    VIEW_SHARED_PROMPTS = "view_shared_prompts"
    EDIT_SHARED_PROMPTS = "edit_shared_prompts"
    VIEW_ACTIVITY = "view_activity"
    MANAGE_MEMBERS = "manage_members"
    MANAGE_PROJECT = "manage_project"
    DELETE_PROJECT = "delete_project"
    CHANGE_MODE = "change_mode"


# Minimum role required for each capability.
CAPABILITY_MIN_ROLE = {
    Capability.VIEW: Role.VIEWER,
    Capability.VIEW_ACTIVITY: Role.VIEWER,
    Capability.VIEW_SHARED_PROMPTS: Role.VIEWER,
    Capability.CREATE_TASK: Role.MEMBER,
    Capability.EDIT_TASK: Role.MEMBER,
    Capability.COMPLETE_TASK: Role.MEMBER,
    Capability.COMMENT: Role.MEMBER,
    Capability.TRACK_TIME: Role.MEMBER,
    Capability.EDIT_SHARED_PROMPTS: Role.MEMBER,
    Capability.DELETE_TASK: Role.ADMIN,
    Capability.MANAGE_MEMBERS: Role.ADMIN,
    Capability.MANAGE_PROJECT: Role.ADMIN,
    Capability.CHANGE_MODE: Role.OWNER,
    Capability.DELETE_PROJECT: Role.OWNER,
}

# What an assistant may do inside the principal's projects. Object-level scoping (only tasks the
# assistant created) is enforced by `visible_to` querysets and `can_*_object(created_by_id=...)`.
ASSISTANT_CAPABILITIES = frozenset(
    {
        Capability.VIEW,
        Capability.CREATE_TASK,
        Capability.EDIT_TASK,
        Capability.COMPLETE_TASK,
        Capability.DELETE_TASK,
        Capability.TRACK_TIME,
    }
)


def is_assistant_of(user, owner_id: int) -> bool:
    """True when `user` is an assistant account acting for the user with pk `owner_id`."""
    return user is not None and getattr(user, "assistant_for_id", None) == owner_id


@dataclass(frozen=True)
class ProjectAccess:
    role: str | None
    is_owner: bool

    def can(self, capability: str) -> bool:
        if self.is_owner:
            return True
        if self.role == Role.ASSISTANT:
            return capability in ASSISTANT_CAPABILITIES
        return Role.at_least(self.role, CAPABILITY_MIN_ROLE[capability])

    @property
    def is_member(self) -> bool:
        return self.is_owner or self.role is not None

    @property
    def is_assistant(self) -> bool:
        return self.role == Role.ASSISTANT


def project_access(user: User | None, project: Project) -> ProjectAccess:
    if user is None or not getattr(user, "is_authenticated", False):
        return ProjectAccess(role=None, is_owner=False)
    if project.owner_id == user.pk:
        return ProjectAccess(role=Role.OWNER, is_owner=True)
    if is_assistant_of(user, project.owner_id):
        return ProjectAccess(role=Role.ASSISTANT, is_owner=False)
    if project.mode == project.Mode.PRIVATE:
        return ProjectAccess(role=None, is_owner=False)
    role = _membership_role(user, project)
    return ProjectAccess(role=role, is_owner=False)


def _membership_role(user: User, project: Project) -> str | None:
    cached = getattr(project, "_membership_roles", None)
    if cached is not None:
        return cached.get(user.pk)
    from apps.projects.models import ProjectMembership

    return (
        ProjectMembership.objects.filter(project=project, user=user, accepted_at__isnull=False)
        .values_list("role", flat=True)
        .first()
    )


def can_view_project(user, project) -> bool:
    return project_access(user, project).can(Capability.VIEW)


def can(user, project, capability: str) -> bool:
    return project_access(user, project).can(capability)


def can_view_object(
    user: User | None,
    *,
    owner_id: int,
    project: Project | None,
    visibility: str,
    created_by_id: int | None = None,
) -> bool:
    """
    Generic rule for tasks / prompts / comments:
      - owner always sees their own object
      - an assistant sees the principal's object only when it created it (`created_by_id`)
      - objects without a project are personal -> owner only
      - project objects: viewer+ may see GROUP-visible objects; PRIVATE objects only the owner
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if owner_id == user.pk:
        return True
    if getattr(user, "assistant_for_id", None) is not None:
        # Assistants never inherit membership visibility; they only see what they created.
        return is_assistant_of(user, owner_id) and created_by_id is not None and created_by_id == user.pk
    if project is None:
        return False
    if visibility == Visibility.PRIVATE:
        return False
    if project.mode == project.Mode.PRIVATE:
        return False
    return project_access(user, project).can(Capability.VIEW)


def can_edit_object(
    user,
    *,
    owner_id: int,
    project,
    visibility: str,
    capability: str = Capability.EDIT_TASK,
    created_by_id: int | None = None,
) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if owner_id == user.pk:
        return True
    if getattr(user, "assistant_for_id", None) is not None:
        return (
            is_assistant_of(user, owner_id)
            and created_by_id is not None
            and created_by_id == user.pk
            and capability in ASSISTANT_CAPABILITIES
        )
    if project is None or visibility == Visibility.PRIVATE or project.mode == project.Mode.PRIVATE:
        return False
    return project_access(user, project).can(capability)
