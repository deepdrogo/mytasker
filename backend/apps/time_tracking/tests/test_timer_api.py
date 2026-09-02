from datetime import timedelta

import pytest
from django.utils import timezone

from apps.time_tracking.models import TimeEntry

pytestmark = pytest.mark.django_db


def _task(client, **kw):
    payload = {"title": "Work", "kind": "business"}
    payload.update(kw)
    return client.post("/api/v1/tasks/", payload, format="json").data


def test_single_running_timer(auth_client, user):
    task = _task(auth_client)
    first = auth_client.post("/api/v1/timer/start/", {"task_id": task["id"]}, format="json")
    assert first.status_code == 201
    assert first.data["is_running"] is True
    assert first.data["category"] == "business"

    second = auth_client.post("/api/v1/timer/start/", {"category": "personal"}, format="json")
    assert second.status_code == 201
    assert TimeEntry.objects.filter(owner=user, ended_at__isnull=True).count() == 1
    assert TimeEntry.objects.get(pk=first.data["id"]).ended_at is not None

    state = auth_client.get("/api/v1/timer/")
    assert state.data["running"]["id"] == second.data["id"]

    stopped = auth_client.post("/api/v1/timer/stop/")
    assert stopped.status_code == 200
    assert stopped.data["duration_seconds"] >= 1
    assert auth_client.post("/api/v1/timer/stop/").status_code == 404


def test_resume_links_entries(auth_client):
    task = _task(auth_client)
    entry = auth_client.post("/api/v1/timer/start/", {"task_id": task["id"]}, format="json").data
    auth_client.post("/api/v1/timer/stop/")
    resumed = auth_client.post(f"/api/v1/timer/entries/{entry['id']}/resume/")
    assert resumed.status_code == 201
    assert resumed.data["resumed_from"] == entry["id"]
    assert resumed.data["task"]["id"] == task["id"]


def test_manual_entry_validation_and_totals(auth_client):
    now = timezone.now()
    bad = auth_client.post(
        "/api/v1/timer/entries/",
        {"started_at": now.isoformat(), "ended_at": (now - timedelta(hours=1)).isoformat()},
        format="json",
    )
    assert bad.status_code == 400
    ok = auth_client.post(
        "/api/v1/timer/entries/",
        {
            "started_at": (now - timedelta(hours=2)).isoformat(),
            "ended_at": (now - timedelta(hours=1)).isoformat(),
            "category": "business",
        },
        format="json",
    )
    assert ok.status_code == 201
    assert ok.data["duration_seconds"] == 3600
    totals = auth_client.get("/api/v1/timer/totals/", {"window": "week"})
    assert totals.data["business"] >= 3600


def test_cannot_start_timer_on_foreign_task(client_for, user, stranger):
    task = _task(client_for(user))
    res = client_for(stranger).post("/api/v1/timer/start/", {"task_id": task["id"]}, format="json")
    assert res.status_code == 404


def test_sleep_tracking(auth_client):
    auth_client.post("/api/v1/timer/start/", {"category": "personal"}, format="json")
    started = auth_client.post("/api/v1/sleep/start/")
    assert started.status_code == 201
    # Starting sleep stops any running work timer.
    assert auth_client.get("/api/v1/timer/").data["running"] is None
    assert auth_client.post("/api/v1/sleep/start/").status_code == 409
    stopped = auth_client.post("/api/v1/sleep/stop/")
    assert stopped.status_code == 200
    assert stopped.data["is_running"] is False
