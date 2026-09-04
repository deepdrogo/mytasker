from datetime import timedelta

import pytest
from django.utils import timezone

from apps.analytics.models import DailySummary

pytestmark = pytest.mark.django_db


def test_today_snapshot_and_daily_review(auth_client):
    now = timezone.now()
    t1 = auth_client.post(
        "/api/v1/tasks/", {"title": "Due now", "kind": "business", "due_at": now.isoformat()}, format="json"
    ).data
    auth_client.post(
        "/api/v1/tasks/",
        {"title": "Overdue", "kind": "personal", "due_at": (now - timedelta(days=2)).isoformat()},
        format="json",
    )
    auth_client.post("/api/v1/tasks/", {"title": "Focus", "kind": "personal", "priority": "high"}, format="json")
    auth_client.post(f"/api/v1/tasks/{t1['id']}/complete/")
    auth_client.post("/api/v1/timer/start/", {"category": "business"}, format="json")
    auth_client.post("/api/v1/timer/stop/")

    res = auth_client.get("/api/v1/today/")
    assert res.status_code == 200, res.content
    data = res.data
    assert [t["title"] for t in data["tasks"]["completed"]] == ["Due now"]
    assert [t["title"] for t in data["tasks"]["overdue"]] == ["Overdue"]
    assert [t["title"] for t in data["tasks"]["focus"]] == ["Focus"]
    assert data["metrics"]["tasks_completed"] == 1
    assert data["metrics"]["business_completed"] == 1
    assert data["streak"] == 1

    daily = auth_client.get("/api/v1/analytics/daily/")
    assert daily.status_code == 200
    assert daily.data["metrics"]["tasks_completed"] == 1


def test_weekly_review_backfills_summaries(auth_client, user):
    res = auth_client.get("/api/v1/analytics/weekly/")
    assert res.status_code == 200
    assert len(res.data["days"]) == 7
    # Past days of this week got materialised, today stays live.
    past_days = [d for d in res.data["days"] if d["date"] < timezone.localdate()]
    assert DailySummary.objects.filter(user=user).count() >= len(past_days)
    monthly = auth_client.get("/api/v1/analytics/monthly/")
    assert monthly.status_code == 200
    assert monthly.data["totals"]["tasks_completed"] == 0
    assert len(monthly.data["weeks"]) >= 4


def test_today_excludes_crypto_world(auth_client):
    now = timezone.now()
    auth_client.post(
        "/api/v1/tasks/",
        {"title": "Watch BTC", "kind": "crypto", "due_at": now.isoformat(), "priority": "high"},
        format="json",
    )
    auth_client.post("/api/v1/tasks/", {"title": "Life errand", "kind": "personal", "priority": "high"}, format="json")

    data = auth_client.get("/api/v1/today/").data
    titles = (
        [t["title"] for t in data["tasks"]["due_today"]]
        + [t["title"] for t in data["tasks"]["focus"]]
        + [t["title"] for t in data["tasks"]["personal"]]
        + [t["title"] for t in data["tasks"]["business"]]
        + [t["title"] for t in data["tasks"]["overdue"]]
        + [t["title"] for t in data["tasks"]["upcoming"]]
    )
    assert "Watch BTC" not in titles
    assert "Life errand" in titles
