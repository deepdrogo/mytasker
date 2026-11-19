"""Advertising work: the violet dot on projects and the ad kind of task."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db


def test_project_ad_flag_round_trips_and_filters(auth_client, user, make_project):
    picked = make_project(user, name="Drogo Pay")
    other = make_project(user, name="Other")

    response = auth_client.patch(f"/api/v1/projects/{picked.pk}/", {"is_ad": True}, format="json")
    assert response.status_code == 200
    assert response.data["is_ad"] is True

    ads = auth_client.get("/api/v1/projects/", {"is_ad": "true"}).data["results"]
    assert [row["id"] for row in ads] == [picked.pk]
    # The project stays everywhere else too.
    every = {row["id"] for row in auth_client.get("/api/v1/projects/").data["results"]}
    assert {picked.pk, other.pk} <= every


def test_only_a_manager_can_light_the_dot(client_for, user, stranger, make_project):
    project = make_project(user)
    response = client_for(stranger).patch(f"/api/v1/projects/{project.pk}/", {"is_ad": True}, format="json")
    assert response.status_code in (403, 404)
    project.refresh_from_db()
    assert project.is_ad is False


def test_ad_tasks_are_created_filtered_and_inherited(auth_client, user, make_project):
    project = make_project(user)
    ad = auth_client.post(
        "/api/v1/tasks/", {"title": "Launch banner", "project_id": project.pk, "is_ad": True}, format="json"
    ).data
    auth_client.post("/api/v1/tasks/", {"title": "Plain"}, format="json")
    assert ad["is_ad"] is True

    listed = auth_client.get("/api/v1/tasks/", {"is_ad": "true"}).data["results"]
    assert [row["id"] for row in listed] == [ad["id"]]

    sub = auth_client.post(f"/api/v1/tasks/{ad['id']}/subtasks/", {"title": "Copy"}, format="json")
    assert sub.status_code == 201, sub.data
    assert sub.data["is_ad"] is True

    off = auth_client.patch(f"/api/v1/tasks/{ad['id']}/", {"is_ad": False}, format="json")
    assert off.status_code == 200 and off.data["is_ad"] is False
    assert auth_client.get("/api/v1/tasks/", {"is_ad": "true", "top_level": "true"}).data["results"] == []
