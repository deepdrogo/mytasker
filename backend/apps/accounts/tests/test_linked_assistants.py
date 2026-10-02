"""Linked assistants: an ordinary account writes tasks into someone's lists and sees only what it wrote there."""

from __future__ import annotations

import pytest

from apps.notifications.models import Notification
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


@pytest.fixture
def boss(make_user):
    return make_user("boss@example.com", full_name="Boss", is_staff=True)


@pytest.fixture
def cede(make_user):
    return make_user("cede@example.com", full_name="Cede")


def link(client, email: str) -> dict:
    response = client.post("/api/v1/auth/assistants/linked/", {"email": email}, format="json")
    assert response.status_code == 201, response.data
    return response.data


def test_link_list_and_unlink(client_for, boss, cede, make_user):
    owner = client_for(boss)
    row = link(owner, "CEDE@example.com")
    assert row["user"]["display_name"] == "Cede" and row["tasks_created"] == 0
    assert link(owner, cede.email)["id"] == row["id"]  # linking twice is a no-op

    bad = owner.post("/api/v1/auth/assistants/linked/", {"email": "nobody@example.com"}, format="json")
    assert bad.status_code == 400
    me = owner.post("/api/v1/auth/assistants/linked/", {"email": boss.email}, format="json")
    assert me.status_code == 400
    restricted = make_user("login@example.com", assistant_for=boss)
    assert (
        owner.post("/api/v1/auth/assistants/linked/", {"email": restricted.email}, format="json").status_code == 400
    )

    helper = client_for(cede)
    assert helper.get("/api/v1/auth/helping/").data == [
        {"user": {"id": boss.pk, "display_name": "Boss"}, "open_count": 0, "done_count": 0}
    ]
    # Only the principal manages the link.
    assert helper.delete(f"/api/v1/auth/assistants/linked/{row['id']}/").status_code == 404
    assert owner.delete(f"/api/v1/auth/assistants/linked/{row['id']}/").status_code == 204
    assert helper.get("/api/v1/auth/helping/").data == []


def test_linked_assistant_writes_for_principal_and_sees_only_that(
    client_for, boss, cede, django_capture_on_commit_callbacks
):
    owner = client_for(boss)
    link(owner, cede.email)
    owner.post("/api/v1/tasks/", {"title": "Boss secret", "kind": "personal"}, format="json")
    helper = client_for(cede)
    helper.post("/api/v1/tasks/", {"title": "Cede own errand", "kind": "personal"}, format="json")

    with django_capture_on_commit_callbacks(execute=True):
        created = helper.post(
            "/api/v1/tasks/", {"title": "Call the bank", "kind": "business", "for_user": boss.pk}, format="json"
        )
    assert created.status_code == 201, created.data
    assert created.data["owner"]["id"] == boss.pk
    assert created.data["created_by"]["id"] == cede.pk
    assert created.data["added_by_assistant"] is True
    task = Task.objects.get(pk=created.data["id"])
    assert task.project_id is None and task.kind == "business"

    # The principal sees it in their lists, marked, on the dashboard, and gets told.
    business = owner.get("/api/v1/tasks/", {"kind": "business", "top_level": "true"}).data["results"]
    assert [(row["title"], row["added_by_assistant"]) for row in business] == [("Call the bank", True)]
    dashboard = owner.get("/api/v1/today/").data
    assert "Call the bank" in {row["title"] for row in dashboard["tasks"]["business"]}
    note = Notification.objects.get(user=boss, event_name="assistant.task_added")
    assert note.title == "Cede added a task for you" and note.body == "Call the bank"

    # The helper: their own plate stays theirs; the For page shows only what they wrote.
    own = helper.get("/api/v1/tasks/", {"top_level": "true"}).data["results"]
    assert [row["title"] for row in own] == ["Cede own errand"]
    assert {row["title"] for row in helper.get("/api/v1/today/").data["tasks"]["personal"]} == {"Cede own errand"}
    for_page = helper.get("/api/v1/tasks/", {"added_for": boss.pk, "top_level": "true"}).data["results"]
    assert [row["title"] for row in for_page] == ["Call the bank"]
    assert for_page[0]["can_edit"] is True
    secret = Task.objects.get(title="Boss secret")
    assert helper.get(f"/api/v1/tasks/{secret.pk}/").status_code == 404
    assert helper.get("/api/v1/tasks/", {"added_for": boss.pk, "q": "secret"}).data["results"] == []
    assert helper.get("/api/v1/auth/helping/").data[0]["open_count"] == 1

    # They can fix and finish what they wrote, but not move it into a project or hand it on.
    edited = helper.patch(f"/api/v1/tasks/{task.pk}/", {"title": "Call the bank at 10"}, format="json")
    assert edited.status_code == 200, edited.data
    assert helper.patch(f"/api/v1/tasks/{task.pk}/", {"kind": "personal"}, format="json").status_code == 403
    assert helper.post(f"/api/v1/tasks/{task.pk}/complete/").status_code == 200
    assert helper.patch(f"/api/v1/tasks/{secret.pk}/", {"title": "x"}, format="json").status_code == 404

    # After unlinking, the task stays with the principal and leaves the helper's view.
    link_id = owner.get("/api/v1/auth/assistants/linked/").data[0]["id"]
    assert owner.get("/api/v1/auth/assistants/linked/").data[0]["tasks_created"] == 1
    owner.delete(f"/api/v1/auth/assistants/linked/{link_id}/")
    assert helper.get(f"/api/v1/tasks/{task.pk}/").status_code == 404
    assert Task.objects.filter(pk=task.pk, owner=boss).exists()


def test_writing_for_someone_needs_a_link_and_stays_out_of_projects(client_for, boss, cede, make_project):
    helper = client_for(cede)
    denied = helper.post("/api/v1/tasks/", {"title": "Sneak in", "for_user": boss.pk}, format="json")
    assert denied.status_code == 403
    assert not Task.objects.filter(title="Sneak in").exists()

    link(client_for(boss), cede.email)
    project = make_project(boss, name="Shop")
    in_project = helper.post(
        "/api/v1/tasks/", {"title": "Into the shop", "for_user": boss.pk, "project_id": project.id}, format="json"
    )
    assert in_project.status_code == 400
    crypto = helper.post("/api/v1/tasks/", {"title": "Coins", "for_user": boss.pk, "kind": "crypto"}, format="json")
    assert crypto.status_code == 400
    handed = helper.post(
        "/api/v1/tasks/", {"title": "Hand it", "for_user": boss.pk, "assignee_ids": [cede.pk]}, format="json"
    )
    assert handed.status_code == 201 and handed.data["assignees"] == []


def test_assistant_login_tasks_are_marked_and_announced(
    client_for, boss, make_user, django_capture_on_commit_callbacks
):
    login = make_user("assistant-login@example.com", full_name="Nino", assistant_for=boss)
    with django_capture_on_commit_callbacks(execute=True):
        created = client_for(login).post("/api/v1/tasks/", {"title": "Book flights"}, format="json")
    assert created.status_code == 201
    rows = client_for(boss).get("/api/v1/tasks/", {"top_level": "true"}).data["results"]
    assert [(row["title"], row["added_by_assistant"]) for row in rows] == [("Book flights", True)]
    assert Notification.objects.filter(user=boss, event_name="assistant.task_added").count() == 1
