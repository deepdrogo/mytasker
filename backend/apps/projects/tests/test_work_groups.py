"""Shelves on the Working projects board: create, rename, reorder, and sort projects into them."""

import pytest

pytestmark = pytest.mark.django_db

GROUPS = "/api/v1/work-groups/"
PROJECTS = "/api/v1/projects/"


def test_create_rename_reorder_and_assign(auth_client):
    first = auth_client.post(GROUPS, {"name": "  AI  "}, format="json")
    assert first.status_code == 201, first.content
    assert first.data["name"] == "AI"
    second = auth_client.post(GROUPS, {"name": "Crypto"}, format="json").data

    renamed = auth_client.patch(f"{GROUPS}{first.data['id']}/", {"name": "Products"}, format="json")
    assert renamed.status_code == 200
    assert renamed.data["name"] == "Products"

    order = auth_client.post(f"{GROUPS}reorder/", {"ids": [second["id"], first.data["id"]]}, format="json")
    assert order.data["ids"] == [second["id"], first.data["id"]]
    listed = auth_client.get(GROUPS).data
    assert [row["name"] for row in listed] == ["Crypto", "Products"]

    project = auth_client.post(PROJECTS, {"name": "Lidaro"}, format="json").data
    moved = auth_client.patch(f"{PROJECTS}{project['id']}/", {"work_group_id": second["id"]}, format="json")
    assert moved.status_code == 200, moved.content
    assert moved.data["work_group_id"] == second["id"]

    cleared = auth_client.patch(f"{PROJECTS}{project['id']}/", {"work_group_id": None}, format="json")
    assert cleared.data["work_group_id"] is None


def test_deleting_a_group_returns_its_projects_to_no_group(auth_client):
    group = auth_client.post(GROUPS, {"name": "Shelf"}, format="json").data
    project = auth_client.post(PROJECTS, {"name": "One"}, format="json").data
    auth_client.patch(f"{PROJECTS}{project['id']}/", {"work_group_id": group["id"]}, format="json")

    removed = auth_client.delete(f"{GROUPS}{group['id']}/")
    assert removed.status_code == 204
    assert auth_client.get(f"{PROJECTS}{project['id']}/").data["work_group_id"] is None


def test_another_users_group_cannot_be_used_or_seen(auth_client, client_for, stranger):
    group = auth_client.post(GROUPS, {"name": "Mine"}, format="json").data
    foreign = client_for(stranger)
    assert foreign.get(GROUPS).data == []
    assert foreign.patch(f"{GROUPS}{group['id']}/", {"name": "Stolen"}, format="json").status_code == 404

    project = foreign.post(PROJECTS, {"name": "Theirs"}, format="json").data
    denied = foreign.patch(f"{PROJECTS}{project['id']}/", {"work_group_id": group["id"]}, format="json")
    assert denied.status_code == 400


def test_blank_group_name_is_rejected(auth_client):
    assert auth_client.post(GROUPS, {"name": "   "}, format="json").status_code == 400
