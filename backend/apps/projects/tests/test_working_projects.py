"""Working projects catalog: the per-project `is_working` flag and its toggle endpoint."""

from __future__ import annotations

import pytest

from apps.projects.models import Project

pytestmark = pytest.mark.django_db


def test_new_project_is_not_working_by_default(client_for, user):
    created = client_for(user).post("/api/v1/projects/", {"name": "Fresh"}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["is_working"] is False


def test_toggle_working_on_and_off(client_for, user, make_project):
    project = make_project(user, name="Launch")
    client = client_for(user)

    on = client.post(f"/api/v1/projects/{project.id}/working/", {"working": True}, format="json")
    assert on.status_code == 200, on.data
    assert on.data["is_working"] is True
    project.refresh_from_db()
    assert project.is_working is True

    off = client.post(f"/api/v1/projects/{project.id}/working/", {"working": False}, format="json")
    assert off.status_code == 200
    assert off.data["is_working"] is False


def test_working_toggle_does_not_bump_version(client_for, user, make_project):
    project = make_project(user, name="Steady")
    before = project.version
    client_for(user).post(f"/api/v1/projects/{project.id}/working/", {"working": True}, format="json")
    project.refresh_from_db()
    assert project.version == before


def test_stranger_cannot_toggle_working(client_for, user, stranger, make_project):
    project = make_project(user, name="Private")
    response = client_for(stranger).post(f"/api/v1/projects/{project.id}/working/", {"working": True}, format="json")
    assert response.status_code == 404
    project.refresh_from_db()
    assert project.is_working is False


def test_default_manager_still_lists_working_projects(user, make_project):
    """Archiving is a separate concern — a working flag must never hide a project from the lists."""
    make_project(user, name="A", is_working=True)
    make_project(user, name="B", is_working=False)
    assert Project.objects.visible_to(user).count() == 2


def test_create_project_as_inactive(client_for, user):
    created = client_for(user).post("/api/v1/projects/", {"name": "Someday", "is_working": False}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["is_working"] is False


def test_create_project_as_active(client_for, user):
    created = client_for(user).post("/api/v1/projects/", {"name": "Now", "is_working": True}, format="json")
    assert created.status_code == 201, created.data
    assert created.data["is_working"] is True


def test_edit_project_working_via_update(client_for, user, make_project):
    project = make_project(user, name="Edit me", is_working=False)
    updated = client_for(user).patch(f"/api/v1/projects/{project.id}/", {"is_working": True}, format="json")
    assert updated.status_code == 200, updated.data
    assert updated.data["is_working"] is True
