"""Cycle reset, the week summary and the day-by-day time history."""

from datetime import timedelta

import pytest
from django.utils import timezone

from apps.time_tracking import services
from apps.time_tracking.models import SleepSession, TimeEntry
from common.tz import day_bounds, today_for

pytestmark = pytest.mark.django_db


def _sleep(user, start, end):
    return SleepSession.objects.create(
        owner=user, started_at=start, ended_at=end, duration_seconds=int((end - start).total_seconds())
    )


def _entry(user, category, start, end, note=""):
    return TimeEntry.objects.create(
        owner=user,
        category=category,
        started_at=start,
        ended_at=end,
        duration_seconds=int((end - start).total_seconds()),
        note=note,
    )


def test_reset_counts_only_from_the_reset_and_keeps_entries(user):
    now = timezone.now()
    _entry(user, "business", now - timedelta(hours=5), now - timedelta(hours=3))
    _entry(user, "fun", now - timedelta(hours=1), now - timedelta(minutes=30))
    services.reset_cycle(user, at=now - timedelta(hours=2))

    data = services.cycle(user, now=now)

    assert data["seconds"]["business"] == 0
    assert data["seconds"]["fun"] == 30 * 60
    assert data["free_seconds"] == 2 * 3600 - 30 * 60
    assert data["reset_at"] == now - timedelta(hours=2)
    assert TimeEntry.objects.filter(owner=user).count() == 2


def test_a_reset_older_than_a_day_no_longer_limits_the_window(user):
    now = timezone.now()
    services.reset_cycle(user, at=now - timedelta(hours=30))
    _entry(user, "business", now - timedelta(hours=20), now - timedelta(hours=19))

    data = services.cycle(user, now=now)

    assert data["reset_at"] is None
    assert data["seconds"]["business"] == 3600


def test_reset_endpoint_and_undo(auth_client, user):
    now = timezone.now()
    _entry(user, "business", now - timedelta(hours=3), now - timedelta(hours=2))

    reset = auth_client.post("/api/v1/timer/cycle/reset/")
    assert reset.status_code == 200
    assert reset.data["seconds"]["business"] == 0
    assert reset.data["reset_at"] is not None

    undone = auth_client.delete("/api/v1/timer/cycle/reset/")
    assert undone.status_code == 200
    assert undone.data["reset_at"] is None
    assert undone.data["seconds"]["business"] == 3600


def test_week_sums_every_day_without_double_counting(user):
    start, _ = day_bounds(user, today_for(user))
    _sleep(user, start, start + timedelta(hours=2))
    # Overlaps the sleep by one hour: only the awake hour counts.
    _entry(user, "business", start + timedelta(hours=1), start + timedelta(hours=3))

    data = services.week_summary(user, now=start + timedelta(hours=5))

    assert data["seconds"]["sleep"] == 2 * 3600
    assert data["seconds"]["business"] == 3600
    assert data["total"] == 3 * 3600
    assert len(data["days"]) == 7
    assert sum(day["total"] for day in data["days"]) == 3 * 3600


def test_week_endpoint(auth_client):
    response = auth_client.get("/api/v1/timer/week/")
    assert response.status_code == 200
    assert set(response.data["seconds"]) == {"sleep", "personal", "business", "fun", "exercise"}


def test_history_lists_days_newest_first_with_labels_and_pages_back(auth_client, user):
    # Past days only, so the test never depends on the hour it runs at. Today is empty and is skipped.
    today = today_for(user)
    for back in (1, 2, 3):
        start, _ = day_bounds(user, today - timedelta(days=back))
        _entry(user, "business", start + timedelta(hours=1), start + timedelta(hours=2), note=f"day {back}")

    first = auth_client.get("/api/v1/timer/history/", {"days": 2})
    assert first.status_code == 200
    assert [day["date"] for day in first.data["days"]] == [today - timedelta(days=1), today - timedelta(days=2)]
    assert first.data["days"][0]["items"][0]["label"] == "day 1"
    assert first.data["days"][0]["seconds"]["business"] == 3600

    nxt = first.data["next_before"]
    assert nxt == today - timedelta(days=2)
    second = auth_client.get("/api/v1/timer/history/", {"days": 2, "before": nxt.isoformat()})
    assert [day["date"] for day in second.data["days"]] == [today - timedelta(days=3)]
    assert second.data["next_before"] is None


def test_history_rejects_a_bad_date(auth_client):
    assert auth_client.get("/api/v1/timer/history/", {"before": "yesterday"}).status_code == 400


def test_reset_saves_what_the_ring_held_and_back_to_back_cycles_do_not_overlap(user):
    from apps.time_tracking.models import CycleSnapshot

    now = timezone.now()
    _sleep(user, now - timedelta(hours=10), now - timedelta(hours=3))
    _entry(user, "business", now - timedelta(hours=3), now - timedelta(hours=1))
    first = services.reset_cycle(user, at=now - timedelta(minutes=30))

    assert first.sleep_seconds == 7 * 3600
    assert first.business_seconds == 2 * 3600
    assert first.ended_at == now - timedelta(minutes=30)

    _entry(user, "fun", now - timedelta(minutes=20), now - timedelta(minutes=10))
    second = services.reset_cycle(user, at=now)

    # The second cycle starts where the first ended, so nothing is counted in both.
    assert second.started_at == first.ended_at
    assert second.seconds == {"sleep": 0, "business": 0, "fun": 600, "exercise": 0, "personal": 0}
    assert CycleSnapshot.objects.filter(owner=user).count() == 2


def test_resetting_an_empty_ring_saves_nothing(user):
    from apps.time_tracking.models import CycleSnapshot

    assert services.reset_cycle(user) is None
    assert not CycleSnapshot.objects.filter(owner=user).exists()


def test_undo_removes_only_the_latest_snapshot(auth_client, user):
    from apps.time_tracking.models import CycleSnapshot

    now = timezone.now()
    _entry(user, "business", now - timedelta(hours=4), now - timedelta(hours=3))
    services.reset_cycle(user, at=now - timedelta(hours=2))
    _entry(user, "fun", now - timedelta(hours=1), now - timedelta(minutes=30))

    auth_client.post("/api/v1/timer/cycle/reset/")
    assert CycleSnapshot.objects.filter(owner=user).count() == 2

    auth_client.delete("/api/v1/timer/cycle/reset/")
    left = list(CycleSnapshot.objects.filter(owner=user))
    assert len(left) == 1
    assert left[0].business_seconds == 3600


def test_snapshot_list_sums_every_saved_cycle_and_deletes_one(auth_client, user):
    now = timezone.now()
    _entry(user, "business", now - timedelta(hours=5), now - timedelta(hours=4))
    services.reset_cycle(user, at=now - timedelta(hours=3))
    _entry(user, "business", now - timedelta(hours=2), now - timedelta(hours=1))
    services.reset_cycle(user, at=now)

    data = auth_client.get("/api/v1/timer/cycle/snapshots/").data
    assert data["count"] == 2
    assert data["totals"]["seconds"]["business"] == 2 * 3600
    assert data["totals"]["total"] == 2 * 3600
    assert [row["seconds"]["business"] for row in data["results"]] == [3600, 3600]
    assert data["next_page"] is None

    newest = data["results"][0]["id"]
    assert auth_client.delete(f"/api/v1/timer/cycle/snapshots/{newest}/").status_code == 204
    assert auth_client.get("/api/v1/timer/cycle/snapshots/").data["count"] == 1
    assert auth_client.delete(f"/api/v1/timer/cycle/snapshots/{newest}/").status_code == 404
