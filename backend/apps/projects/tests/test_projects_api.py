import pytest

from apps.projects.models import Project

pytestmark = pytest.mark.django_db

BASE = "/api/v1/projects/"


def test_create_project_and_progress(auth_client):
    res = auth_client.post(BASE, {"name": "Launch", "mode": "private"}, format="json")
    assert res.status_code == 201, res.content
    pid = res.data["id"]
    # Nothing to measure yet: progress is absent rather than a misleading 0%.
    assert res.data["progress"] is None
    assert res.data["task_total"] == 0
    t1 = auth_client.post("/api/v1/tasks/", {"title": "A", "kind": "business", "project_id": pid}, format="json").data
    auth_client.post("/api/v1/tasks/", {"title": "B", "kind": "business", "project_id": pid}, format="json")
    auth_client.post(f"/api/v1/tasks/{t1['id']}/complete/")

    detail = auth_client.get(f"{BASE}{pid}/")
    assert detail.status_code == 200
    assert detail.data["task_total"] == 2
    assert detail.data["task_done"] == 1
    assert detail.data["progress"] == 50

    overview = auth_client.get(f"{BASE}{pid}/overview/")
    assert overview.status_code == 200
    assert overview.data["stats"]["total"] == 2


def test_startup_category_is_stored_and_filterable(auth_client):
    startup = auth_client.post(BASE, {"name": "Hyperblast", "category": "startup"}, format="json")
    assert startup.status_code == 201, startup.content
    assert startup.data["category"] == "startup"
    plain = auth_client.post(BASE, {"name": "House"}, format="json")
    assert plain.data["category"] == "general"

    startups = auth_client.get(f"{BASE}?category=startup").data["results"]
    assert [p["name"] for p in startups] == ["Hyperblast"]

    moved = auth_client.patch(f"{BASE}{plain.data['id']}/", {"category": "startup"}, format="json")
    assert moved.status_code == 200
    assert moved.data["category"] == "startup"


def test_reorder_projects_drives_dashboard_order(auth_client, client_for, stranger):
    ids = [auth_client.post(BASE, {"name": name}, format="json").data["id"] for name in ("A", "B", "C")]
    for pid in ids:
        auth_client.post("/api/v1/tasks/", {"title": f"t{pid}", "kind": "business", "project_id": pid}, format="json")
    foreign = client_for(stranger).post(BASE, {"name": "Not mine"}, format="json").data["id"]

    # Unknown / foreign ids are ignored, the rest gets the new order; nothing about the projects "changes".
    before = auth_client.get(f"{BASE}{ids[0]}/").data
    res = auth_client.post(f"{BASE}reorder/", {"ids": [ids[2], foreign, ids[0], ids[1], 999999]}, format="json")
    assert res.status_code == 200, res.content
    assert res.data["ids"] == [ids[2], ids[0], ids[1]]
    after = auth_client.get(f"{BASE}{ids[0]}/").data
    assert after["version"] == before["version"]
    assert after["updated_at"] == before["updated_at"]
    assert Project.objects.get(pk=foreign).sort_order == 0

    listed = [p["id"] for p in auth_client.get(f"{BASE}?ordering=manual").data["results"]]
    assert listed == [ids[2], ids[0], ids[1]]
    dashboard = [p["id"] for p in auth_client.get("/api/v1/today/").data["active_projects"]]
    assert dashboard == [ids[2], ids[0], ids[1]]

    assert auth_client.post(f"{BASE}reorder/", {"ids": []}, format="json").status_code == 400
    assert auth_client.post(f"{BASE}reorder/", {"ids": ["x"]}, format="json").status_code == 400


def test_invite_join_and_group_visibility(client_for, user, other_user, stranger):
    owner = client_for(user)
    project = owner.post(BASE, {"name": "Team", "mode": "group"}, format="json").data
    invite = owner.post(
        f"{BASE}{project['id']}/members/", {"email": other_user.email, "role": "member"}, format="json"
    )
    assert invite.status_code == 201, invite.content
    token = invite.data["invite_url"].split("token=")[1]

    member = client_for(other_user)
    assert member.get(f"{BASE}{project['id']}/").status_code == 404  # not accepted yet
    # A different account cannot hijack the invitation.
    assert client_for(stranger).post("/api/v1/projects/join/", {"token": token}, format="json").status_code == 403
    joined = member.post("/api/v1/projects/join/", {"token": token}, format="json")
    assert joined.status_code == 200, joined.content
    assert joined.data["role"] == "member"
    # Tokens are single use.
    assert member.post("/api/v1/projects/join/", {"token": token}, format="json").status_code == 400

    assert member.get(f"{BASE}{project['id']}/").status_code == 200
    assert client_for(stranger).get(f"{BASE}{project['id']}/").status_code == 404

    owner.post("/api/v1/tasks/", {"title": "Shared", "kind": "business", "project_id": project["id"]}, format="json")
    titles = {t["title"] for t in member.get("/api/v1/tasks/", {"project": project["id"]}).data["results"]}
    assert titles == {"Shared"}


def test_private_project_cannot_invite(auth_client, other_user):
    project = auth_client.post(BASE, {"name": "Solo"}, format="json").data
    res = auth_client.post(
        f"{BASE}{project['id']}/members/", {"email": other_user.email, "role": "member"}, format="json"
    )
    assert res.status_code == 400


def test_member_cannot_change_mode_or_delete(client_for, user, other_user, make_project, add_member):
    project = make_project(user, mode=Project.Mode.GROUP)
    add_member(project, other_user)
    member = client_for(other_user)
    assert member.post(f"{BASE}{project.pk}/mode/", {"mode": "group_plus"}, format="json").status_code == 403
    assert member.delete(f"{BASE}{project.pk}/").status_code == 403


def test_group_plus_private_task_hidden_from_member(client_for, user, other_user, make_project, add_member):
    project = make_project(user, mode=Project.Mode.GROUP_PLUS)
    add_member(project, other_user)
    owner = client_for(user)
    owner.post(
        "/api/v1/tasks/",
        {"title": "Mine", "kind": "business", "project_id": project.pk, "visibility": "private"},
        format="json",
    )
    owner.post("/api/v1/tasks/", {"title": "Ours", "kind": "business", "project_id": project.pk}, format="json")
    titles = {
        t["title"] for t in client_for(other_user).get("/api/v1/tasks/", {"project": project.pk}).data["results"]
    }
    assert titles == {"Ours"}


def test_idea_conversion(auth_client):
    idea = auth_client.post("/api/v1/ideas/", {"title": "Podcast", "raw_text": "Weekly show"}, format="json")
    assert idea.status_code == 201, idea.content
    converted = auth_client.post(f"/api/v1/ideas/{idea.data['id']}/convert/")
    assert converted.status_code in (200, 201), converted.content
    assert converted.data["name"] == "Podcast"
    again = auth_client.post(f"/api/v1/ideas/{idea.data['id']}/convert/")
    assert again.status_code in (400, 409)
