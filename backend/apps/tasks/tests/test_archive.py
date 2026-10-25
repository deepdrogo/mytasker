"""Task archive: reversible soft-archive, Archive section listing, and the clean-slate helpers."""

from __future__ import annotations

import pytest

from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


def _create(client, title, **extra):
    return client.post("/api/v1/tasks/", {"title": title, **extra}, format="json").data


def test_archive_hides_task_from_default_lists(client_for, user):
    client = client_for(user)
    task = _create(client, "Old task")

    archived = client.post(f"/api/v1/tasks/{task['id']}/archive/")
    assert archived.status_code == 200, archived.data
    assert archived.data["is_archived"] is True

    # Gone from the default list…
    listing = client.get("/api/v1/tasks/").data
    assert all(row["id"] != task["id"] for row in listing["results"])
    # …but present in the Archive view.
    archived_list = client.get("/api/v1/tasks/", {"archived": "1"}).data
    assert any(row["id"] == task["id"] for row in archived_list["results"])


def test_archived_task_excluded_from_default_manager(client_for, user):
    task = _create(client_for(user), "Hide me")
    client_for(user).post(f"/api/v1/tasks/{task['id']}/archive/")
    assert Task.objects.filter(pk=task["id"]).count() == 0
    assert Task.all_objects.filter(pk=task["id"]).count() == 1


def test_unarchive_restores_task(client_for, user):
    client = client_for(user)
    task = _create(client, "Bring back")
    client.post(f"/api/v1/tasks/{task['id']}/archive/")

    restored = client.post(f"/api/v1/tasks/{task['id']}/unarchive/")
    assert restored.status_code == 200
    assert restored.data["is_archived"] is False
    assert any(row["id"] == task["id"] for row in client.get("/api/v1/tasks/").data["results"])


def test_archiving_parent_cascades_to_subtasks(client_for, user):
    client = client_for(user)
    parent = _create(client, "Parent")
    client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "Child"}, format="json")

    client.post(f"/api/v1/tasks/{parent['id']}/archive/")
    assert Task.all_objects.filter(parent_id=parent["id"], archived_at__isnull=False).count() == 1
    assert Task.objects.filter(parent_id=parent["id"]).count() == 0

    client.post(f"/api/v1/tasks/{parent['id']}/unarchive/")
    assert Task.objects.filter(parent_id=parent["id"]).count() == 1


def test_archive_all_and_unarchive_all(client_for, user):
    client = client_for(user)
    for i in range(3):
        _create(client, f"Task {i}")

    result = client.post("/api/v1/tasks/archive-all/")
    assert result.status_code == 200
    assert result.data["archived"] == 3
    assert client.get("/api/v1/tasks/").data["count"] == 0

    restored = client.post("/api/v1/tasks/unarchive-all/")
    assert restored.data["restored"] == 3
    assert client.get("/api/v1/tasks/").data["count"] == 3


def test_archive_all_can_keep_completed(client_for, user):
    client = client_for(user)
    open_task = _create(client, "Open")
    done = _create(client, "Done")
    client.post(f"/api/v1/tasks/{done['id']}/complete/")

    result = client.post("/api/v1/tasks/archive-all/", {"include_completed": False}, format="json")
    assert result.data["archived"] == 1
    remaining = {row["id"] for row in client.get("/api/v1/tasks/", {"completed": "true"}).data["results"]}
    assert done["id"] in remaining
    assert open_task["id"] not in {row["id"] for row in client.get("/api/v1/tasks/").data["results"]}


def test_stranger_cannot_archive_others_task(client_for, user, stranger):
    task = _create(client_for(user), "Private")
    response = client_for(stranger).post(f"/api/v1/tasks/{task['id']}/archive/")
    assert response.status_code == 404
    assert Task.objects.filter(pk=task["id"]).count() == 1


def test_archive_tasks_for_user_command(client_for, user):
    from io import StringIO

    from django.core.management import call_command

    client = client_for(user)
    for i in range(2):
        _create(client, f"T{i}")

    call_command("archive_tasks_for_user", user.email, stdout=StringIO())
    assert Task.objects.filter(owner=user).count() == 0

    call_command("archive_tasks_for_user", user.email, "--undo", stdout=StringIO())
    assert Task.objects.filter(owner=user).count() == 2
