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

    ORDER = {OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3}

    @classmethod
    def at_least(cls, role: str | None, minimum: str) -> bool:
        if role is None:
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


@dataclass(frozen=True)
class ProjectAccess:
    role: str | None
    is_owner: bool

    def can(self, capability: str) -> bool:
        if self.is_owner:
            return True
        return Role.at_least(self.role, CAPABILITY_MIN_ROLE[capability])

    @property
    def is_member(self) -> bool:
        return self.is_owner or self.role is not None


def project_access(user: User | None, project: Project) -> ProjectAccess:
    if user is None or not getattr(user, "is_authenticated", False):
        return ProjectAccess(role=None, is_owner=False)
    if project.owner_id == user.pk:
        return ProjectAccess(role=Role.OWNER, is_owner=True)
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


def can_view_object(user: User | None, *, owner_id: int, project: Project | None, visibility: str) -> bool:
    """
    Generic rule for tasks / prompts / comments:
      - owner always sees their own object
      - objects without a project are personal -> owner only
      - project objects: viewer+ may see GROUP-visible objects; PRIVATE objects only the owner
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if owner_id == user.pk:
        return True
    if project is None:
        return False
    if visibility == Visibility.PRIVATE:
        return False
    if project.mode == project.Mode.PRIVATE:
        return False
    return project_access(user, project).can(Capability.VIEW)


def can_edit_object(user, *, owner_id: int, project, visibility: str, capability: str = Capability.EDIT_TASK) -> bool:
    if user is None or not getattr(user, "is_authenticated", False):
        return False
    if owner_id == user.pk:
        return True
    if project is None or visibility == Visibility.PRIVATE or project.mode == project.Mode.PRIVATE:
        return False
    return project_access(user, project).can(capability)
