"""Client work, moving tasks between lists / projects, and the word-based global search."""

from __future__ import annotations

import pytest

from apps.projects.models import Project, ProjectMembership
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


# --------------------------------------------------------------------------- clients


def test_client_flag_round_trips_and_filters(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user, name="MyMask")
    created = client.post(
        "/api/v1/tasks/",
        {"title": "Fit a video card", "kind": "business", "project_id": project.id, "is_client": True},
        format="json",
    )
    assert created.status_code == 201, created.data
    assert created.data["is_client"] is True
    client.post("/api/v1/tasks/", {"title": "Own thing", "kind": "business"}, format="json")

    only_clients = client.get("/api/v1/tasks/", {"is_client": "true"}).data
    assert [row["title"] for row in only_clients["results"]] == ["Fit a video card"]

    no_clients = client.get("/api/v1/tasks/", {"is_client": "false"}).data
    assert [row["title"] for row in no_clients["results"]] == ["Own thing"]

    counts = client.get("/api/v1/tasks/counts/").data
    assert counts["clients"] == 1


def test_client_tasks_pinned_to_top_of_every_ordering(client_for, user):
    client = client_for(user)
    client.post("/api/v1/tasks/", {"title": "A plain", "priority": "critical"}, format="json")
    client.post("/api/v1/tasks/", {"title": "B plain"}, format="json")
    client.post("/api/v1/tasks/", {"title": "Z client", "priority": "low", "is_client": True}, format="json")

    for ordering in ("manual", "priority", "title", "-created"):
        rows = client.get("/api/v1/tasks/", {"ordering": ordering}).data["results"]
        assert rows[0]["title"] == "Z client", ordering

    unpinned = client.get("/api/v1/tasks/", {"ordering": "title", "pin_clients": "0"}).data["results"]
    assert [row["title"] for row in unpinned] == ["A plain", "B plain", "Z client"]


def test_client_flag_cascades_to_subtasks(client_for, user):
    client = client_for(user)
    parent = client.post("/api/v1/tasks/", {"title": "Rebuild PC", "is_client": True}, format="json").data
    sub = client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "Order parts"}, format="json").data
    assert sub["is_client"] is True

    client.patch(f"/api/v1/tasks/{parent['id']}/", {"is_client": False}, format="json")
    assert Task.objects.get(pk=sub["id"]).is_client is False


def test_dashboard_lists_client_work_first(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user, name="MyMask")
    client.post("/api/v1/tasks/", {"title": "Personal chore", "kind": "personal"}, format="json")
    client.post(
        "/api/v1/tasks/",
        {"title": "Client job", "kind": "business", "project_id": project.id, "is_client": True},
        format="json",
    )
    client.post(
        "/api/v1/tasks/", {"title": "Client no project", "kind": "personal", "is_client": True}, format="json"
    )

    snapshot = client.get("/api/v1/today/").data
    titles = [row["title"] for row in snapshot["tasks"]["clients"]]
    assert titles == ["Client job", "Client no project"]
    # The plate does not repeat what the Clients block already shows.
    assert [row["title"] for row in snapshot["tasks"]["personal"]] == ["Personal chore"]


# --------------------------------------------------------------------------- move


def test_move_personal_task_into_project_and_back(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user, name="MyMask")
    task = client.post(
        "/api/v1/tasks/", {"title": "Call client", "kind": "personal", "is_client": True}, format="json"
    ).data
    sub = client.post(f"/api/v1/tasks/{task['id']}/subtasks/", {"title": "Find number"}, format="json").data

    moved = client.post(f"/api/v1/tasks/{task['id']}/move/", {"project_id": project.id}, format="json")
    assert moved.status_code == 200, moved.data
    assert moved.data["project"]["id"] == project.id
    assert moved.data["origin"] == "project"
    assert moved.data["kind"] == "business"
    assert moved.data["is_client"] is True
    child = Task.objects.get(pk=sub["id"])
    assert child.project_id == project.id and child.kind == "business" and child.origin == "project"

    back = client.post(f"/api/v1/tasks/{task['id']}/move/", {"kind": "personal"}, format="json")
    assert back.status_code == 200, back.data
    assert back.data["project"] is None
    assert back.data["origin"] == "list"
    assert back.data["kind"] == "personal"
    child.refresh_from_db()
    assert child.project_id is None and child.kind == "personal"

    listed = client.get("/api/v1/tasks/", {"kind": "personal", "top_level": "true"}).data
    assert [row["title"] for row in listed["results"]] == ["Call client"]


def test_move_requires_exactly_one_destination(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user)
    task = client.post("/api/v1/tasks/", {"title": "X"}, format="json").data
    assert client.post(f"/api/v1/tasks/{task['id']}/move/", {}, format="json").status_code == 400
    both = client.post(
        f"/api/v1/tasks/{task['id']}/move/", {"kind": "personal", "project_id": project.id}, format="json"
    )
    assert both.status_code == 400


def test_subtask_cannot_be_moved_alone(client_for, user):
    client = client_for(user)
    parent = client.post("/api/v1/tasks/", {"title": "P"}, format="json").data
    sub = client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "S"}, format="json").data
    assert client.post(f"/api/v1/tasks/{sub['id']}/move/", {"kind": "business"}, format="json").status_code == 400


def test_member_cannot_pull_shared_task_into_own_list(client_for, user, other_user, make_project, add_member):
    project = make_project(user, name="Team", mode=Project.Mode.GROUP)
    add_member(project, other_user, ProjectMembership.Role.ADMIN)
    task = client_for(user).post("/api/v1/tasks/", {"title": "Shared", "project_id": project.id}, format="json").data
    response = client_for(other_user).post(f"/api/v1/tasks/{task['id']}/move/", {"kind": "personal"}, format="json")
    assert response.status_code == 403
    assert Task.objects.get(pk=task["id"]).project_id == project.id


def test_bulk_move_reports_skipped(client_for, user, stranger, make_project):
    client = client_for(user)
    project = make_project(user)
    mine = client.post("/api/v1/tasks/", {"title": "Mine"}, format="json").data
    theirs = client_for(stranger).post("/api/v1/tasks/", {"title": "Theirs"}, format="json").data

    result = client.post(
        "/api/v1/tasks/bulk-move/", {"task_ids": [mine["id"], theirs["id"]], "project_id": project.id}, format="json"
    )
    assert result.status_code == 200, result.data
    assert result.data == {"moved": [mine["id"]], "skipped": [theirs["id"]]}


def test_changing_project_via_patch_carries_subtasks(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user)
    parent = client.post("/api/v1/tasks/", {"title": "P", "kind": "business"}, format="json").data
    sub = client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "S"}, format="json").data
    client.patch(f"/api/v1/tasks/{parent['id']}/", {"project_id": project.id}, format="json")
    assert Task.objects.get(pk=sub["id"]).project_id == project.id


# --------------------------------------------------------------------------- search


def test_search_matches_any_field_in_any_word_order(client_for, user, make_project):
    client = client_for(user)
    project = make_project(user, name="MyMask")
    client.post(
        "/api/v1/tasks/",
        {"title": "Fit a video card", "project_id": project.id, "notes": "GPU for Nika", "tags": ["hardware"]},
        format="json",
    )
    client.post("/api/v1/tasks/", {"title": "Unrelated"}, format="json")

    def titles(q: str) -> list[str]:
        return [row["title"] for row in client.get("/api/v1/search/", {"q": q}).data["tasks"]]

    assert titles("mymask video") == ["Fit a video card"]  # project name + title word, any order
    assert titles("nika") == ["Fit a video card"]  # notes
    assert titles("hardw") == ["Fit a video card"]  # tag prefix
    assert titles("v") == ["Fit a video card"]  # single character is enough to start
    assert titles("video nothing") == []  # every word has to match


def test_search_puts_exact_title_hits_and_open_work_first(client_for, user):
    client = client_for(user)
    done = client.post("/api/v1/tasks/", {"title": "Card done"}, format="json").data
    client.post(f"/api/v1/tasks/{done['id']}/complete/")
    client.post("/api/v1/tasks/", {"title": "Notes mention", "description": "video card inside"}, format="json")
    client.post("/api/v1/tasks/", {"title": "Video card"}, format="json")

    rows = client.get("/api/v1/search/", {"q": "video card"}).data["tasks"]
    assert [row["title"] for row in rows][:2] == ["Video card", "Notes mention"]
