from datetime import timedelta

import pytest
from django.utils import timezone

from apps.projects.models import Project, ProjectMembership
from apps.tasks.models import Task
from common.models import Visibility

pytestmark = pytest.mark.django_db


def test_create_personal_task(client_for, user):
    client = client_for(user)
    response = client.post("/api/v1/tasks/", {"title": "Call dentist", "kind": "personal"}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["title"] == "Call dentist"
    assert response.data["kind"] == "personal"
    assert response.data["visibility"] == Visibility.PRIVATE


def test_title_required(client_for, user):
    response = client_for(user).post("/api/v1/tasks/", {"title": "   "}, format="json")
    assert response.status_code == 400
    assert response.data["error"]["code"] == "validation_error"


def test_complete_and_reopen(client_for, user):
    client = client_for(user)
    task_id = client.post("/api/v1/tasks/", {"title": "Gym"}, format="json").data["id"]

    done = client.post(f"/api/v1/tasks/{task_id}/complete/")
    assert done.status_code == 200
    assert done.data["status"] == "done"
    assert done.data["completed_at"] is not None
    assert done.data["completion_source"] == "web"

    reopened = client.post(f"/api/v1/tasks/{task_id}/reopen/")
    assert reopened.status_code == 200
    assert reopened.data["status"] == "todo"
    assert reopened.data["completed_at"] is None


def test_subtask_depth_limited(client_for, user):
    client = client_for(user)
    parent = client.post("/api/v1/tasks/", {"title": "Launch"}, format="json").data
    child = client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "Deploy"}, format="json")
    assert child.status_code == 201

    grandchild = client.post(f"/api/v1/tasks/{child.data['id']}/subtasks/", {"title": "Nope"}, format="json")
    assert grandchild.status_code == 400


def test_completing_parent_cascades_to_subtasks(client_for, user):
    client = client_for(user)
    parent = client.post("/api/v1/tasks/", {"title": "Ship"}, format="json").data
    client.post(f"/api/v1/tasks/{parent['id']}/subtasks/", {"title": "Test"}, format="json")
    client.post(f"/api/v1/tasks/{parent['id']}/complete/")
    assert Task.objects.filter(parent_id=parent["id"], status=Task.Status.DONE).count() == 1


def test_other_user_cannot_see_private_task(client_for, user, stranger):
    task_id = client_for(user).post("/api/v1/tasks/", {"title": "Secret"}, format="json").data["id"]
    response = client_for(stranger).get(f"/api/v1/tasks/{task_id}/")
    assert response.status_code == 404


def test_group_member_sees_group_task_but_not_private(client_for, user, other_user, make_project, add_member):
    project = make_project(user, name="HyperBlast", mode=Project.Mode.GROUP_PLUS)
    add_member(project, other_user, ProjectMembership.Role.MEMBER)
    owner = client_for(user)

    shared = owner.post(
        "/api/v1/tasks/",
        {"title": "Fix API", "project_id": project.id, "visibility": "group"},
        format="json",
    ).data
    private = owner.post(
        "/api/v1/tasks/",
        {"title": "Financial planning", "project_id": project.id, "visibility": "private"},
        format="json",
    ).data
    assert private["visibility"] == "private"

    member = client_for(other_user)
    assert member.get(f"/api/v1/tasks/{shared['id']}/").status_code == 200
    assert member.get(f"/api/v1/tasks/{private['id']}/").status_code == 404

    listing = member.get("/api/v1/tasks/", {"project": project.id}).data
    titles = {row["title"] for row in listing["results"]}
    assert "Fix API" in titles
    assert "Financial planning" not in titles


def test_version_conflict(client_for, user):
    client = client_for(user)
    task = client.post("/api/v1/tasks/", {"title": "Race"}, format="json").data
    client.patch(f"/api/v1/tasks/{task['id']}/", {"title": "Race v2"}, format="json")
    stale = client.patch(
        f"/api/v1/tasks/{task['id']}/", {"title": "Race v3", "version": task["version"]}, format="json"
    )
    assert stale.status_code == 409
    assert stale.data["error"]["code"] == "version_conflict"


def test_recurrence_spawns_single_next_instance(client_for, user):
    client = client_for(user)
    due = (timezone.now() + timezone.timedelta(hours=2)).isoformat()
    task = client.post(
        "/api/v1/tasks/",
        {"title": "Daily standup", "due_at": due, "due_has_time": True, "recurrence": {"freq": "daily"}},
        format="json",
    ).data
    client.post(f"/api/v1/tasks/{task['id']}/complete/")
    children = Task.objects.filter(recurrence_parent_id=task["id"])
    assert children.count() == 1
    assert children.first().due_at > timezone.now()


def test_view_filters(client_for, user):
    client = client_for(user)
    past = (timezone.now() - timezone.timedelta(days=2)).isoformat()
    client.post("/api/v1/tasks/", {"title": "Late", "due_at": past}, format="json")
    client.post("/api/v1/tasks/", {"title": "Someday"}, format="json")

    overdue = client.get("/api/v1/tasks/", {"view": "overdue"}).data
    assert [row["title"] for row in overdue["results"]] == ["Late"]

    no_date = client.get("/api/v1/tasks/", {"view": "no_date"}).data
    assert [row["title"] for row in no_date["results"]] == ["Someday"]


def test_counts_endpoint(client_for, user):
    client = client_for(user)
    client.post("/api/v1/tasks/", {"title": "A", "kind": "personal"}, format="json")
    client.post("/api/v1/tasks/", {"title": "B", "kind": "business"}, format="json")
    counts = client.get("/api/v1/tasks/counts/").data
    assert counts["personal"] == 1
    assert counts["business"] == 1


def test_business_list_only_shows_tasks_added_from_the_list(client_for, user):
    """
    Tasks typed inside a project page stay in that project; tasks typed on the Business page
    show up there even when linked to a project - and in the project as well.
    """
    client = client_for(user)
    pid = client.post("/api/v1/projects/", {"name": "Drogoz"}, format="json").data["id"]

    from_project = client.post(
        "/api/v1/tasks/", {"title": "Inside project", "kind": "business", "project_id": pid}, format="json"
    ).data
    assert from_project["origin"] == "project"

    from_list = client.post(
        "/api/v1/tasks/",
        {"title": "From business list", "kind": "business", "project_id": pid, "origin": "list"},
        format="json",
    ).data
    assert from_list["origin"] == "list"
    assert from_list["project"]["id"] == pid

    plain = client.post("/api/v1/tasks/", {"title": "No project", "kind": "business"}, format="json").data
    assert plain["origin"] == "list"

    business = client.get("/api/v1/tasks/?kind=business&origin=list&top_level=true").data["results"]
    assert sorted(t["title"] for t in business) == ["From business list", "No project"]

    in_project = client.get(f"/api/v1/tasks/?project={pid}").data["results"]
    assert sorted(t["title"] for t in in_project) == ["From business list", "Inside project"]

    counts = client.get("/api/v1/tasks/counts/").data
    assert counts["business"] == 2

    # Detaching a project-only task from its project moves it back into the list so it stays reachable.
    detached = client.patch(f"/api/v1/tasks/{from_project['id']}/", {"project_id": None}, format="json").data
    assert detached["origin"] == "list"
    assert detached["project"] is None


def test_bulk_reschedule_sets_and_clears_deadline_and_skips_foreign_tasks(client_for, user, make_user):
    client = client_for(user)
    a = client.post("/api/v1/tasks/", {"title": "A"}, format="json").data["id"]
    b = client.post("/api/v1/tasks/", {"title": "B"}, format="json").data["id"]
    foreign = Task.objects.create(owner=make_user("other@example.com"), title="theirs", kind="personal")

    res = client.post(
        "/api/v1/tasks/bulk-reschedule/",
        {"task_ids": [a, b, foreign.pk, a], "due_at": "2030-01-15T20:59:00Z", "due_has_time": False},
        format="json",
    )
    assert res.status_code == 200, res.content
    assert res.data == {"updated": [a, b], "skipped": [foreign.pk]}
    for task_id in (a, b):
        task = client.get(f"/api/v1/tasks/{task_id}/").data
        assert task["due_at"].startswith("2030-01-15T20:59")
        assert task["due_has_time"] is False
    foreign.refresh_from_db()
    assert foreign.due_at is None

    cleared = client.post("/api/v1/tasks/bulk-reschedule/", {"task_ids": [a], "due_at": None}, format="json")
    assert cleared.status_code == 200
    assert client.get(f"/api/v1/tasks/{a}/").data["due_at"] is None

    assert (
        client.post("/api/v1/tasks/bulk-reschedule/", {"task_ids": [], "due_at": None}, format="json").status_code
        == 400
    )


def test_crypto_list_is_isolated_from_mixed_views(client_for, user):
    client = client_for(user)
    future = (timezone.now() + timedelta(days=3)).isoformat()
    client.post("/api/v1/tasks/", {"title": "Buy ETH", "kind": "crypto", "due_at": future}, format="json")
    client.post("/api/v1/tasks/", {"title": "Call mom", "kind": "personal", "due_at": future}, format="json")

    crypto = client.get("/api/v1/tasks/?kind=crypto&top_level=true&completed=false").data["results"]
    assert [row["title"] for row in crypto] == ["Buy ETH"]

    upcoming = client.get("/api/v1/tasks/", {"view": "upcoming", "exclude_kind": "crypto"}).data["results"]
    assert [row["title"] for row in upcoming] == ["Call mom"]

    counts = client.get("/api/v1/tasks/counts/").data
    assert counts["crypto"] == 1
    assert counts["upcoming"] == 1
