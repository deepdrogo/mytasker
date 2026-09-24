"""People: an administrator hands tasks to other accounts; they see, edit, comment and complete - never delete."""

from __future__ import annotations

import pytest

from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin(make_user):
    return make_user("drogoz@example.com", is_staff=True, full_name="Drogoz")


@pytest.fixture
def nino(make_user):
    return make_user("nino@example.com", full_name="Nino")


def add_person(client, email: str, note: str = "") -> dict:
    response = client.post("/api/v1/people/", {"email": email, "note": note}, format="json")
    assert response.status_code == 201, response.data
    return response.data


def test_only_staff_manage_people(client_for, user, nino):
    client = client_for(user)  # not staff
    assert client.get("/api/v1/people/").status_code == 403
    assert client.post("/api/v1/people/", {"email": nino.email}, format="json").status_code == 403
    assert client.get("/api/v1/people/search/", {"q": "nino"}).status_code == 403


def test_add_search_update_remove_person(client_for, admin, nino):
    client = client_for(admin)
    found = client.get("/api/v1/people/search/", {"q": "nin"}).data
    assert [row["email"] for row in found] == [nino.email]

    person = add_person(client, nino.email, note="assistant")
    assert person["user"]["display_name"] == "Nino"
    assert person["note"] == "assistant"
    assert person["open_count"] == 0

    # Already on the list -> no longer offered by search.
    assert client.get("/api/v1/people/search/", {"q": "nin"}).data == []

    updated = client.patch(f"/api/v1/people/{person['id']}/", {"note": "Nino - PC builds"}, format="json")
    assert updated.status_code == 200 and updated.data["note"] == "Nino - PC builds"

    assert client.delete(f"/api/v1/people/{person['id']}/").status_code == 204
    assert client.get("/api/v1/people/").data == []


def test_cannot_hand_task_to_someone_not_on_people(client_for, admin, nino):
    client = client_for(admin)
    response = client.post("/api/v1/tasks/", {"title": "Fit GPU", "assignee_id": nino.pk}, format="json")
    assert response.status_code == 400
    assert "assignee" in response.data["error"]["fields"]


def test_delegated_task_visible_and_workable_for_assignee_but_not_deletable(client_for, admin, nino):
    owner = client_for(admin)
    add_person(owner, nino.email)
    task = owner.post(
        "/api/v1/tasks/",
        {"title": "Fit GPU for the client", "kind": "business", "assignee_id": nino.pk, "is_client": True},
        format="json",
    ).data
    assert task["assignee"]["id"] == nino.pk

    me = client_for(nino)
    seen = me.get(f"/api/v1/tasks/{task['id']}/")
    assert seen.status_code == 200
    assert seen.data["can_edit"] is True
    assert seen.data["can_delete"] is False

    # Content edits and completion are fine ...
    assert (
        me.patch(f"/api/v1/tasks/{task['id']}/", {"title": "Fit GPU (done twice)"}, format="json").status_code == 200
    )
    assert me.post(f"/api/v1/tasks/{task['id']}/complete/").status_code == 200
    assert me.post(f"/api/v1/tasks/{task['id']}/reopen/").status_code == 200
    # ... comments too ...
    comment = me.post("/api/v1/comments/", {"task_id": task["id"], "body": "On it."}, format="json")
    assert comment.status_code == 201, comment.data
    assert [c["body"] for c in owner.get("/api/v1/comments/", {"task": task["id"]}).data] == ["On it."]
    # ... but not deleting, re-homing or handing it on.
    assert me.delete(f"/api/v1/tasks/{task['id']}/").status_code == 403
    assert me.post(f"/api/v1/tasks/{task['id']}/move/", {"kind": "personal"}, format="json").status_code == 403
    assert me.patch(f"/api/v1/tasks/{task['id']}/", {"assignee_id": admin.pk}, format="json").status_code == 403
    assert me.patch(f"/api/v1/tasks/{task['id']}/", {"is_client": False}, format="json").status_code == 403
    assert Task.objects.get(pk=task["id"]).owner_id == admin.pk


def dashboard_titles(snapshot: dict) -> set[str]:
    titles = {row["title"] for rows in snapshot["tasks"].values() for row in rows}
    titles |= {task["title"] for project in snapshot["active_projects"] for task in project["next_tasks"]}
    return titles


def test_delegated_work_stays_off_both_dashboards(client_for, admin, nino, make_project):
    owner = client_for(admin)
    add_person(owner, nino.email)
    today = "2030-01-01T10:00:00Z"
    owner.post(
        "/api/v1/tasks/",
        {"title": "Client build for Nino", "kind": "business", "assignee_id": nino.pk, "is_client": True},
        format="json",
    )
    owner.post(
        "/api/v1/tasks/", {"title": "Overdue for Nino", "assignee_id": nino.pk, "due_at": today}, format="json"
    )
    owner.post("/api/v1/tasks/", {"title": "My client job", "kind": "business", "is_client": True}, format="json")
    owner.post("/api/v1/tasks/", {"title": "My chore", "kind": "personal"}, format="json")
    project = make_project(admin, name="Shop")
    owner.post("/api/v1/tasks/", {"title": "Project work for Nino", "project_id": project.id}, format="json")
    handed = Task.objects.get(title="Project work for Nino")
    handed.assignees.set([nino.pk])
    owner.post("/api/v1/tasks/", {"title": "My project work", "project_id": project.id}, format="json")

    # Giver: only what is not handed to anyone - client work included, People work nowhere.
    mine = owner.get("/api/v1/today/").data
    assert dashboard_titles(mine) == {"My client job", "My chore", "My project work"}
    assert [row["title"] for row in mine["tasks"]["clients"]] == ["My client job"]
    assert "delegated" not in mine["tasks"]

    # Receiver: someone else's tasks stay on the "From" page, not on the dashboard.
    me = client_for(nino)
    me.post("/api/v1/tasks/", {"title": "Nino own", "kind": "personal"}, format="json")
    assert dashboard_titles(me.get("/api/v1/today/").data) == {"Nino own"}

    # Taking a task back puts it on the giver's dashboard again.
    back = Task.objects.get(title="Client build for Nino")
    owner.patch(f"/api/v1/tasks/{back.pk}/", {"assignee_ids": []}, format="json")
    assert "Client build for Nino" in dashboard_titles(owner.get("/api/v1/today/").data)


def test_delegated_work_lands_on_from_page_not_in_own_lists(client_for, admin, nino):
    owner = client_for(admin)
    add_person(owner, nino.email)
    owner.post("/api/v1/tasks/", {"title": "Order parts", "kind": "business", "assignee_id": nino.pk}, format="json")
    owner.post("/api/v1/tasks/", {"title": "Call vendor", "kind": "personal", "assignee_id": nino.pk}, format="json")
    me = client_for(nino)
    me.post("/api/v1/tasks/", {"title": "My own", "kind": "personal"}, format="json")

    snapshot = me.get("/api/v1/today/").data
    assert [row["title"] for row in snapshot["tasks"]["personal"]] == ["My own"]

    # "From Drogoz" page.
    delegators = me.get("/api/v1/people/delegators/").data
    assert len(delegators) == 1 and delegators[0]["user"]["display_name"] == "Drogoz"
    assert delegators[0]["open_count"] == 2
    from_page = me.get("/api/v1/tasks/", {"delegated_by": admin.pk, "top_level": "true"}).data
    assert sorted(row["title"] for row in from_page["results"]) == ["Call vendor", "Order parts"]

    # Own Personal list stays mine; Today mixes everything in.
    personal = me.get("/api/v1/tasks/", {"kind": "personal", "delegated": "false", "top_level": "true"}).data
    assert [row["title"] for row in personal["results"]] == ["My own"]
    only_delegated = me.get("/api/v1/tasks/", {"delegated": "true"}).data
    assert sorted(row["title"] for row in only_delegated["results"]) == ["Call vendor", "Order parts"]

    # The People page on the owner's side: counts and the per-person task list.
    people = owner.get("/api/v1/people/").data
    assert people[0]["open_count"] == 2 and people[0]["done_count"] == 0
    mine = owner.get("/api/v1/tasks/", {"assignee": nino.pk, "mine": "true"}).data
    assert mine["count"] == 2

    # Nobody without delegated work gets a "From" page.
    assert owner.get("/api/v1/people/delegators/").data == []


def test_removing_person_takes_back_open_work(client_for, admin, nino):
    owner = client_for(admin)
    person = add_person(owner, nino.email)
    task = owner.post("/api/v1/tasks/", {"title": "Open one", "assignee_id": nino.pk}, format="json").data
    done = owner.post("/api/v1/tasks/", {"title": "Done one", "assignee_id": nino.pk}, format="json").data
    owner.post(f"/api/v1/tasks/{done['id']}/complete/")

    owner.delete(f"/api/v1/people/{person['id']}/")
    assert Task.objects.get(pk=task["id"]).assignee_id is None
    assert Task.objects.get(pk=done["id"]).assignee_id == nino.pk
    assert client_for(nino).get(f"/api/v1/tasks/{task['id']}/").status_code == 404


def test_delegate_can_comment_on_project_task_and_save_full_form(client_for, admin, nino, make_project):
    """The editor re-sends the whole form; unchanged owner-only fields must not trip the delegate up."""
    owner = client_for(admin)
    add_person(owner, nino.email)
    project = make_project(admin, name="MyMask")
    task = owner.post(
        "/api/v1/tasks/",
        {"title": "Order GPU", "project_id": project.id, "assignee_id": nino.pk, "is_client": True},
        format="json",
    ).data

    me = client_for(nino)
    comment = me.post("/api/v1/comments/", {"task_id": task["id"], "body": "Started."}, format="json")
    assert comment.status_code == 201, comment.data

    # Same values as the task already has -> fine; only real changes are refused.
    ok = me.patch(
        f"/api/v1/tasks/{task['id']}/",
        {"title": "Order GPU today", "visibility": task["visibility"], "is_client": True},
        format="json",
    )
    assert ok.status_code == 200, ok.data
    assert ok.data["title"] == "Order GPU today"
    loose = owner.post("/api/v1/tasks/", {"title": "Loose", "assignee_id": nino.pk}, format="json").data
    assert (
        me.patch(f"/api/v1/tasks/{loose['id']}/", {"is_client": False, "project_id": None}, format="json").status_code
        == 200
    )
    assert me.patch(f"/api/v1/tasks/{loose['id']}/", {"is_client": True}, format="json").status_code == 403


def test_assistant_account_can_receive_and_work_delegated_tasks(client_for, admin, make_user):
    """Assistants (restricted logins) are valid People: they see, comment on and complete what they were handed."""
    assistant = make_user("nino-assist@example.com", full_name="Nino", assistant_for=admin)
    owner = client_for(admin)
    assert [row["email"] for row in owner.get("/api/v1/people/search/", {"q": "nino"}).data] == [assistant.email]
    add_person(owner, assistant.email, note="assistant")
    task = owner.post("/api/v1/tasks/", {"title": "Sort invoices", "assignee_id": assistant.pk}, format="json").data

    me = client_for(assistant)
    assert me.get("/api/v1/people/delegators/").data[0]["open_count"] == 1
    listed = me.get("/api/v1/tasks/", {"delegated_by": admin.pk}).data
    assert [row["title"] for row in listed["results"]] == ["Sort invoices"]
    assert (
        me.post("/api/v1/comments/", {"task_id": task["id"], "body": "Done half."}, format="json").status_code == 201
    )
    assert me.post(f"/api/v1/tasks/{task['id']}/complete/").status_code == 200
    assert me.delete(f"/api/v1/tasks/{task['id']}/").status_code == 403
    # The People page itself stays closed to assistants.
    assert me.get("/api/v1/people/").status_code == 403


def test_hand_one_task_to_two_people_and_bulk_assign(client_for, admin, nino, make_user):
    gio = make_user("gio@example.com", full_name="Gio")
    owner = client_for(admin)
    add_person(owner, nino.email)
    add_person(owner, gio.email)

    task = owner.post(
        "/api/v1/tasks/", {"title": "Ten users for Benjamin", "assignee_ids": [nino.pk, gio.pk]}, format="json"
    ).data
    assert sorted(u["id"] for u in task["assignees"]) == sorted([nino.pk, gio.pk])
    assert task["assignee"]["id"] == nino.pk  # legacy single column mirrors the first

    for who in (nino, gio):
        me = client_for(who)
        assert me.get(f"/api/v1/tasks/{task['id']}/").status_code == 200
        assert [row["title"] for row in me.get("/api/v1/tasks/", {"delegated_by": admin.pk}).data["results"]] == [
            "Ten users for Benjamin"
        ]
        assert me.get("/api/v1/people/delegators/").data[0]["open_count"] == 1
    people = {row["user"]["id"]: row for row in owner.get("/api/v1/people/").data}
    assert people[nino.pk]["open_count"] == 1 and people[gio.pk]["open_count"] == 1

    # Bulk: three more tasks handed to both at once, then all taken back from Gio only.
    ids = [owner.post("/api/v1/tasks/", {"title": f"Job {i}"}, format="json").data["id"] for i in range(3)]
    result = owner.post(
        "/api/v1/tasks/bulk-assign/", {"task_ids": ids, "assignee_ids": [gio.pk, nino.pk]}, format="json"
    )
    assert result.status_code == 200 and result.data["updated"] == ids
    assert client_for(gio).get("/api/v1/people/delegators/").data[0]["open_count"] == 4
    owner.post("/api/v1/tasks/bulk-assign/", {"task_ids": ids, "assignee_ids": [nino.pk]}, format="json")
    assert client_for(gio).get("/api/v1/people/delegators/").data[0]["open_count"] == 1
    assert client_for(nino).get("/api/v1/people/delegators/").data[0]["open_count"] == 4
    # Everything back: no "From" page for Gio at all once nothing was ever handed... (history keeps it) - open 0.
    owner.post("/api/v1/tasks/bulk-assign/", {"task_ids": [task["id"]], "assignee_ids": []}, format="json")
    assert client_for(gio).get(f"/api/v1/tasks/{task['id']}/").status_code == 404
