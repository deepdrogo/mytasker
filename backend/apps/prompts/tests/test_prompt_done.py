"""Done prompts leave the library for the Done list and can be reopened."""

import pytest

pytestmark = pytest.mark.django_db


def _prompt(client, title="Write a landing page"):
    return client.post("/api/v1/prompts/", {"title": title, "body": "Do it well."}, format="json").data


def _titles(response):
    return [row["title"] for row in response.data["results"]]


def test_done_moves_a_prompt_to_the_done_list(auth_client):
    keep = _prompt(auth_client, "Keep")
    used = _prompt(auth_client, "Used")

    done = auth_client.post(f"/api/v1/prompts/{used['id']}/done/", {"done": True}, format="json")

    assert done.status_code == 200
    assert done.data["is_done"] is True
    assert done.data["done_at"] is not None
    assert done.data["version"] == used["version"]
    assert _titles(auth_client.get("/api/v1/prompts/")) == [keep["title"]]
    assert _titles(auth_client.get("/api/v1/prompts/", {"done": "true"})) == ["Used"]
    assert auth_client.get("/api/v1/prompts/facets/").data["counts"] == {"open": 1, "done": 1}


def test_reopen_and_toggle_without_body(auth_client):
    prompt = _prompt(auth_client)
    assert auth_client.post(f"/api/v1/prompts/{prompt['id']}/done/").data["is_done"] is True
    reopened = auth_client.post(f"/api/v1/prompts/{prompt['id']}/done/", {"done": False}, format="json")

    assert reopened.data["is_done"] is False
    assert reopened.data["done_at"] is None
    assert _titles(auth_client.get("/api/v1/prompts/")) == [prompt["title"]]


def test_strangers_cannot_mark_done(auth_client, client_for, stranger):
    prompt = _prompt(auth_client)

    assert client_for(stranger).post(f"/api/v1/prompts/{prompt['id']}/done/").status_code == 404
