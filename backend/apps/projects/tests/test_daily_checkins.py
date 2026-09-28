"""Daily check-ins: what the project calendar puts on a day, ticked once that day, kept as history."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from apps.analytics import today as dashboard
from apps.projects import checkins
from apps.projects import views as project_views
from apps.projects.models import DailyCheckin, Project

pytestmark = pytest.mark.django_db

DAILY = "/api/v1/checkins/daily/"
HISTORY = "/api/v1/checkins/history/"
WEDNESDAY = date(2030, 1, 16)


@pytest.fixture(autouse=True)
def today(monkeypatch):
    """Pin "today" (a Wednesday unless a test moves it) so weekends never make the suite flaky."""
    current = {"day": WEDNESDAY}
    for module in (checkins, project_views, dashboard):
        monkeypatch.setattr(module, "today_for", lambda user: current["day"])

    def move_to(day: date) -> None:
        current["day"] = day

    return move_to


@pytest.fixture
def calendar(user, make_project):
    """Zoi Talks / Mamont / Drogo Pay on the calendar around today, plus lines that must not show."""
    today = WEDNESDAY
    return {
        "today": today,
        "zoi": make_project(
            user, name="Zoi Talks", start_date=today - timedelta(days=2), deadline=today + timedelta(days=4)
        ),
        "mamont": make_project(user, name="Mamont", start_date=today, deadline=None),
        "drogo": make_project(user, name="Drogo Pay", start_date=today - timedelta(days=5), deadline=today),
        "later": make_project(
            user, name="Later", start_date=today + timedelta(days=1), deadline=today + timedelta(days=3)
        ),
        "ended": make_project(
            user, name="Ended", start_date=today - timedelta(days=9), deadline=today - timedelta(days=1)
        ),
        "done": make_project(
            user, name="Done", start_date=today - timedelta(days=1), deadline=None, status=Project.Status.COMPLETED
        ),
        "unscheduled": make_project(user, name="Unscheduled"),
    }


def labels(items) -> list[str]:
    return [item["label"] for item in items]


def test_today_lists_exactly_what_the_calendar_puts_on_today(auth_client, calendar):
    data = auth_client.get(DAILY).data
    assert labels(data["items"]) == ["Drogo Pay", "Zoi Talks", "Mamont"]  # calendar order
    assert all(item["checked"] is False and item["streak"] == 0 for item in data["items"])


def test_tick_untick_and_streak(auth_client, user, calendar):
    zoi = calendar["zoi"]
    today = calendar["today"]
    # Yesterday and the day before were ticked already.
    for back in (1, 2):
        DailyCheckin.objects.create(user=user, date=today - timedelta(days=back), project=zoi, label=zoi.name)

    ticked = auth_client.post(DAILY, {"project_id": zoi.pk}, format="json")
    assert ticked.status_code == 200, ticked.data
    assert ticked.data["item"]["checked"] is True
    assert ticked.data["item"]["streak"] == 3
    # Ticking twice is harmless.
    assert auth_client.post(DAILY, {"project_id": zoi.pk}, format="json").status_code == 200
    assert DailyCheckin.objects.filter(user=user, date=today, project=zoi).count() == 1

    unticked = auth_client.post(DAILY, {"project_id": zoi.pk, "checked": False}, format="json")
    assert unticked.data["item"]["checked"] is False
    assert unticked.data["item"]["streak"] == 2  # still alive from yesterday


def test_cannot_tick_what_is_not_scheduled_or_the_future(auth_client, calendar, stranger, make_project):
    today = calendar["today"]
    for project in (calendar["later"], calendar["ended"], calendar["done"], calendar["unscheduled"]):
        assert auth_client.post(DAILY, {"project_id": project.pk}, format="json").status_code == 400
    future = {"project_id": calendar["zoi"].pk, "date": (today + timedelta(days=1)).isoformat()}
    assert auth_client.post(DAILY, future, format="json").status_code == 400
    foreign = make_project(stranger, name="Theirs", start_date=today)
    assert auth_client.post(DAILY, {"project_id": foreign.pk}, format="json").status_code == 404
    assert auth_client.post(DAILY, {}, format="json").status_code == 400


def test_a_forgotten_past_day_can_still_be_ticked(auth_client, calendar):
    yesterday = (calendar["today"] - timedelta(days=1)).isoformat()
    response = auth_client.post(DAILY, {"project_id": calendar["zoi"].pk, "date": yesterday}, format="json")
    assert response.status_code == 200 and response.data["item"]["checked"] is True
    past = auth_client.get(DAILY, {"date": yesterday}).data
    assert labels(past["items"]) == ["Ended", "Drogo Pay", "Zoi Talks"]
    assert next(item for item in past["items"] if item["label"] == "Zoi Talks")["checked"] is True


def test_crypto_world_on_the_calendar_is_a_daily_checkin(auth_client, user, calendar):
    today = calendar["today"]
    auth_client.patch("/api/v1/auth/me/preferences/", {"crypto_world_start": today.isoformat()}, format="json")
    items = auth_client.get(DAILY).data["items"]
    assert labels(items)[-1] == "Crypto world"
    ticked = auth_client.post(DAILY, {"crypto": True}, format="json")
    assert ticked.status_code == 200 and ticked.data["item"]["checked"] is True


def test_history_keeps_ticks_and_misses_per_day(auth_client, user, calendar):
    today = calendar["today"]
    zoi, drogo = calendar["zoi"], calendar["drogo"]
    DailyCheckin.objects.create(user=user, date=today - timedelta(days=1), project=zoi, label=zoi.name)
    auth_client.post(DAILY, {"project_id": drogo.pk}, format="json")

    data = auth_client.get(HISTORY, {"days": 3}).data
    assert [day["date"] for day in data["days"]] == [today - timedelta(days=offset) for offset in range(3)]
    today_row, yesterday_row, before_row = data["days"]
    assert {i["label"]: i["checked"] for i in today_row["items"]} == {
        "Drogo Pay": True,
        "Zoi Talks": False,
        "Mamont": False,
    }
    assert {i["label"]: i["checked"] for i in yesterday_row["items"]} == {
        "Drogo Pay": False,
        "Ended": False,
        "Zoi Talks": True,
    }
    assert (before_row["done"], before_row["total"]) == (0, 3)
    totals = {line["label"]: (line["done"], line["scheduled"]) for line in data["lines"]}
    assert totals["Zoi Talks"] == (1, 3) and totals["Drogo Pay"] == (1, 3) and totals["Mamont"] == (0, 1)


def test_history_survives_taking_a_project_off_the_calendar_or_deleting_it(auth_client, user, calendar):
    zoi = calendar["zoi"]
    auth_client.post(DAILY, {"project_id": zoi.pk}, format="json")
    Project.objects.filter(pk=zoi.pk).update(start_date=None, deadline=None)
    today_row = auth_client.get(HISTORY, {"days": 1}).data["days"][0]
    assert {"label": "Zoi Talks", "checked": True}.items() <= next(
        i for i in today_row["items"] if i["label"] == "Zoi Talks"
    ).items()

    zoi.delete()
    today_row = auth_client.get(HISTORY, {"days": 1}).data["days"][0]
    assert any(i["label"] == "Zoi Talks" and i["checked"] for i in today_row["items"])


def test_dashboard_carries_calendar_checkins_not_long_term_tasks(auth_client, calendar):
    auth_client.post("/api/v1/tasks/", {"title": "Gym", "is_ongoing": True}, format="json")
    snapshot = auth_client.get("/api/v1/today/").data
    assert labels(snapshot["daily_checkins"]) == ["Drogo Pay", "Zoi Talks", "Mamont"]
    assert "ongoing" not in snapshot["tasks"]
    assert "Gym" not in {row["title"] for rows in snapshot["tasks"].values() for row in rows}


def test_weekends_are_gaps_on_the_calendar_and_in_checkins(auth_client, calendar, today):
    saturday = WEDNESDAY + timedelta(days=3)
    today(saturday)
    assert auth_client.get(DAILY).data["items"] == []
    assert auth_client.post(DAILY, {"project_id": calendar["zoi"].pk}, format="json").status_code == 400
    week = auth_client.get(HISTORY, {"days": 7}).data["days"]
    assert [day["total"] for day in week if day["date"].weekday() >= 5] == [0, 0]


def test_a_streak_carries_over_the_weekend(auth_client, user, calendar, today):
    zoi = calendar["zoi"]
    friday, monday = WEDNESDAY + timedelta(days=2), WEDNESDAY + timedelta(days=5)
    Project.objects.filter(pk=zoi.pk).update(deadline=monday + timedelta(days=4))
    for day in (WEDNESDAY, WEDNESDAY + timedelta(days=1), friday):
        DailyCheckin.objects.create(user=user, date=day, project=zoi, label=zoi.name)
    today(monday)
    zoi_today = next(item for item in auth_client.get(DAILY).data["items"] if item["label"] == "Zoi Talks")
    assert zoi_today["checked"] is False and zoi_today["streak"] == 3
    ticked = auth_client.post(DAILY, {"project_id": zoi.pk}, format="json").data["item"]
    assert ticked["streak"] == 4
