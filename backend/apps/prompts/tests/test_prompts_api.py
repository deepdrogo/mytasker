import pytest

from apps.projects.models import Project

pytestmark = pytest.mark.django_db

BASE = "/api/v1/prompts/"


def _create(client, **overrides):
    payload = {"title": "Cold email", "body": "Write a cold email to {{company}} about {{product}}." * 20}
    payload.update(overrides)
    return client.post(BASE, payload, format="json")


def test_create_list_snippet_and_detail(auth_client):
    res = _create(auth_client)
    assert res.status_code == 201, res.content
    pid = res.data["id"]

    listed = auth_client.get(BASE)
    assert listed.status_code == 200
    row = listed.data["results"][0]
    assert "body" not in row
    assert len(row["snippet"]) <= 201  # ellipsis allowed
    assert row["body_length"] > 200

    detail = auth_client.get(f"{BASE}{pid}/")
    assert detail.status_code == 200
    assert detail.data["body"].startswith("Write a cold email")
    assert detail.data["can_edit"] is True


def test_version_history_and_restore(auth_client):
    pid = _create(auth_client, body="v1 body").data["id"]
    res = auth_client.patch(f"{BASE}{pid}/", {"body": "v2 body"}, format="json")
    assert res.status_code == 200
    assert res.data["version"] == 2

    versions = auth_client.get(f"{BASE}{pid}/versions/")
    assert [v["number"] for v in versions.data] == [1]

    restored = auth_client.post(f"{BASE}{pid}/versions/1/")
    assert restored.status_code == 200
    assert restored.data["body"] == "v1 body"
    assert restored.data["version"] == 3


def test_version_conflict(auth_client):
    pid = _create(auth_client).data["id"]
    res = auth_client.patch(f"{BASE}{pid}/", {"title": "New", "version": 99}, format="json")
    assert res.status_code == 409


def test_private_prompt_in_group_plus_is_hidden_from_members(client_for, user, other_user, make_project, add_member):
    project = make_project(user, mode=Project.Mode.GROUP_PLUS)
    add_member(project, other_user)
    owner = client_for(user)
    member = client_for(other_user)

    private = _create(owner, title="Secret", project_id=project.pk, visibility="private").data
    shared = _create(owner, title="Shared", project_id=project.pk, visibility="group").data
    assert private["visibility"] == "private"
    assert shared["visibility"] == "group"

    titles = {row["title"] for row in member.get(BASE).data["results"]}
    assert titles == {"Shared"}
    assert member.get(f"{BASE}{private['id']}/").status_code == 404
    assert member.get(f"{BASE}{shared['id']}/").status_code == 200
    # Search cannot leak either.
    search = member.get("/api/v1/search/", {"q": "Secret"})
    assert search.status_code == 200
    assert all(item["title"] != "Secret" for item in search.data.get("prompts", []))


def test_stranger_cannot_see_group_prompt(client_for, user, stranger, make_project):
    project = make_project(user, mode=Project.Mode.GROUP)
    pid = _create(client_for(user), project_id=project.pk).data["id"]
    assert client_for(stranger).get(f"{BASE}{pid}/").status_code == 404
    assert client_for(stranger).patch(f"{BASE}{pid}/", {"title": "x"}, format="json").status_code == 404


def test_duplicate_favorite_archive_and_facets(auth_client):
    pid = _create(auth_client, category="Sales", tags=["email", "Outreach"]).data["id"]
    dup = auth_client.post(f"{BASE}{pid}/duplicate/")
    assert dup.status_code == 201
    assert dup.data["title"].endswith("(copy)")

    fav = auth_client.post(f"{BASE}{pid}/favorite/")
    assert fav.data["is_favorite"] is True
    arch = auth_client.post(f"{BASE}{pid}/archive/")
    assert arch.data["is_archived"] is True
    assert len(auth_client.get(BASE).data["results"]) == 1  # archived hidden by default
    assert len(auth_client.get(BASE, {"archived": "true"}).data["results"]) == 1

    facets = auth_client.get(f"{BASE}facets/")
    assert facets.status_code == 200
    assert {t["slug"] for t in facets.data["tags"]} == {"email", "outreach"}


def test_search_by_body(auth_client):
    _create(auth_client, title="A", body="Quarterly revenue forecasting template")
    _create(auth_client, title="B", body="Something unrelated")
    res = auth_client.get(BASE, {"q": "forecasting"})
    assert [r["title"] for r in res.data["results"]] == ["A"]
