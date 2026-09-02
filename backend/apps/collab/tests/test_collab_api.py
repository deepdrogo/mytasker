import pytest

from apps.projects.models import Project

pytestmark = pytest.mark.django_db


def test_comment_on_own_task_and_activity(auth_client):
    task = auth_client.post("/api/v1/tasks/", {"title": "T", "kind": "personal"}, format="json").data
    res = auth_client.post("/api/v1/comments/", {"body": "First!", "task_id": task["id"]}, format="json")
    assert res.status_code == 201, res.content
    assert res.data["can_edit"] is True

    listed = auth_client.get("/api/v1/comments/", {"task": task["id"]})
    assert [c["body"] for c in listed.data] == ["First!"]

    edited = auth_client.patch(f"/api/v1/comments/{res.data['id']}/", {"body": "Edited"}, format="json")
    assert edited.data["edited_at"] is not None

    feed = auth_client.get("/api/v1/activity/")
    names = [row["name"] for row in feed.data["results"]]
    assert "comment.created" in names
    assert "task.created" in names

    assert auth_client.delete(f"/api/v1/comments/{res.data['id']}/").status_code == 204
    assert auth_client.get("/api/v1/comments/", {"task": task["id"]}).data == []


def test_viewer_cannot_comment_but_member_can(client_for, user, other_user, stranger, make_project, add_member):
    from apps.projects.models import ProjectMembership

    project = make_project(user, mode=Project.Mode.GROUP)
    add_member(project, other_user, role=ProjectMembership.Role.VIEWER)
    task = (
        client_for(user)
        .post("/api/v1/tasks/", {"title": "Shared", "kind": "business", "project_id": project.pk}, format="json")
        .data
    )

    viewer = client_for(other_user)
    assert viewer.post("/api/v1/comments/", {"body": "hi", "task_id": task["id"]}, format="json").status_code == 403
    assert viewer.get("/api/v1/comments/", {"task": task["id"]}).status_code == 200

    ProjectMembership.objects.filter(project=project, user=other_user).update(role=ProjectMembership.Role.MEMBER)
    assert viewer.post("/api/v1/comments/", {"body": "hi", "task_id": task["id"]}, format="json").status_code == 201
    assert (
        client_for(stranger)
        .post("/api/v1/comments/", {"body": "x", "task_id": task["id"]}, format="json")
        .status_code
        == 404
    )


def test_group_plus_private_task_activity_hidden(client_for, user, other_user, make_project, add_member):
    project = make_project(user, mode=Project.Mode.GROUP_PLUS)
    add_member(project, other_user)
    owner = client_for(user)
    owner.post(
        "/api/v1/tasks/",
        {"title": "Secret", "kind": "business", "project_id": project.pk, "visibility": "private"},
        format="json",
    )
    owner.post("/api/v1/tasks/", {"title": "Public", "kind": "business", "project_id": project.pk}, format="json")
    feed = client_for(other_user).get("/api/v1/activity/", {"project": project.pk}).data["results"]
    titles = {row["payload"].get("title") for row in feed if row["name"] == "task.created"}
    assert titles == {"Public"}
