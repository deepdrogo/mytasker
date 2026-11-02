"""The rolling 24-hour cycle: sleep, work, fun and exercise counted over the last 24 hours."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.time_tracking import services
from apps.time_tracking.models import SleepSession, TimeEntry

pytestmark = pytest.mark.django_db


def _sleep(user, start, end):
    return SleepSession.objects.create(
        owner=user, started_at=start, ended_at=end, duration_seconds=int((end - start).total_seconds())
    )


def _entry(user, category, start, end):
    return TimeEntry.objects.create(
        owner=user,
        category=category,
        started_at=start,
        ended_at=end,
        duration_seconds=int((end - start).total_seconds()),
    )


def test_split_sleep_adds_up_across_midnight(user):
    now = timezone.now()
    _sleep(user, now - timedelta(hours=20), now - timedelta(hours=19))  # a one-hour nap
    _sleep(user, now - timedelta(hours=12), now - timedelta(hours=4))  # then eight hours
    _sleep(user, now - timedelta(hours=30), now - timedelta(hours=26))  # outside the window

    data = services.cycle(user, now=now)

    assert data["seconds"]["sleep"] == 9 * 3600
    assert [segment["kind"] for segment in data["segments"]] == ["sleep", "sleep"]


def test_window_clips_a_session_that_started_before_it(user):
    now = timezone.now()
    _sleep(user, now - timedelta(hours=26), now - timedelta(hours=22))

    assert services.cycle(user, now=now)["seconds"]["sleep"] == 2 * 3600


def test_every_activity_and_free_time(user):
    now = timezone.now()
    _sleep(user, now - timedelta(hours=24), now - timedelta(hours=16))
    _entry(user, "exercise", now - timedelta(hours=16), now - timedelta(hours=14))
    _entry(user, "business", now - timedelta(hours=14), now - timedelta(hours=6))
    _entry(user, "fun", now - timedelta(hours=6), now - timedelta(hours=2))

    data = services.cycle(user, now=now)

    assert data["seconds"] == {
        "sleep": 8 * 3600,
        "personal": 0,
        "business": 8 * 3600,
        "fun": 4 * 3600,
        "exercise": 2 * 3600,
    }
    assert data["tracked_seconds"] == 22 * 3600
    assert data["free_seconds"] == 2 * 3600


def test_overlaps_never_count_twice(user):
    now = timezone.now()
    _sleep(user, now - timedelta(hours=10), now - timedelta(hours=6))
    # A work entry that ran through the sleep only keeps the awake part.
    _entry(user, "business", now - timedelta(hours=8), now - timedelta(hours=4))

    data = services.cycle(user, now=now)

    assert data["seconds"]["sleep"] == 4 * 3600
    assert data["seconds"]["business"] == 2 * 3600
    assert data["tracked_seconds"] == 6 * 3600


def test_running_timer_counts_up_to_now(auth_client, user):
    auth_client.post("/api/v1/timer/start/", {"category": "fun"}, format="json")
    entry = TimeEntry.objects.get(owner=user, ended_at__isnull=True)
    TimeEntry.objects.filter(pk=entry.pk).update(started_at=timezone.now() - timedelta(minutes=30))

    response = auth_client.get("/api/v1/timer/cycle/")

    assert response.status_code == 200
    assert response.data["running"]["kind"] == "fun"
    assert 29 * 60 <= response.data["seconds"]["fun"] <= 31 * 60
    assert response.data["target_minutes"] == {"sleep": 480, "business": 600, "fun": 240, "exercise": 120}


def test_starting_a_timer_wakes_you_up(auth_client, user):
    auth_client.post("/api/v1/sleep/start/")
    assert SleepSession.objects.filter(owner=user, ended_at__isnull=True).exists()

    started = auth_client.post("/api/v1/timer/start/", {"category": "exercise"}, format="json")

    assert started.status_code == 201
    assert started.data["category"] == "exercise"
    assert not SleepSession.objects.filter(owner=user, ended_at__isnull=True).exists()
    assert auth_client.get("/api/v1/timer/").data["sleep"] is None


def test_new_categories_show_in_today_totals(auth_client, user):
    auth_client.post("/api/v1/timer/start/", {"category": "exercise"}, format="json")
    TimeEntry.objects.filter(owner=user).update(started_at=timezone.now() - timedelta(minutes=5))
    auth_client.post("/api/v1/timer/stop/")

    today = auth_client.get("/api/v1/timer/").data["today"]

    assert set(today) == {"personal", "business", "fun", "exercise", "total"}
    assert today["exercise"] >= 4 * 60


def test_targets_are_preferences(auth_client):
    saved = auth_client.patch(
        "/api/v1/auth/me/preferences/",
        {"fun_target_minutes": 180, "exercise_target_minutes": 90, "business_hours_target_minutes": 480},
        format="json",
    )
    assert saved.status_code == 200

    targets = auth_client.get("/api/v1/timer/cycle/").data["target_minutes"]

    assert targets == {"sleep": 480, "business": 480, "fun": 180, "exercise": 90}
    too_long = auth_client.patch("/api/v1/auth/me/preferences/", {"fun_target_minutes": 2000}, format="json")
    assert too_long.status_code == 400


def test_cycle_is_private(client_for, user, stranger):
    now = timezone.now()
    _sleep(user, now - timedelta(hours=8), now - timedelta(hours=1))

    assert client_for(stranger).get("/api/v1/timer/cycle/").data["seconds"]["sleep"] == 0
