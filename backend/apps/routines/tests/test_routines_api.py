import pytest

pytestmark = pytest.mark.django_db


def test_routine_items_crud_and_completion(auth_client):
    res = auth_client.post(
        "/api/v1/routines/business/items/",
        {"name": "Deep work", "target_minutes": 120, "start_time": "09:00", "end_time": "11:00"},
        format="json",
    )
    assert res.status_code == 201, res.content
    assert res.data["counts_as_business"] is True
    item_id = res.data["id"]

    listed = auth_client.get("/api/v1/routines/business/items/")
    assert listed.status_code == 200
    assert [i["id"] for i in listed.data["items"]] == [item_id]

    done = auth_client.post(f"/api/v1/routines/items/{item_id}/complete/", {"completed": True}, format="json")
    assert done.status_code == 200
    assert done.data["today_completed"] is True

    undone = auth_client.post(
        f"/api/v1/routines/items/{item_id}/complete/", {"completed": False, "manual_minutes": 45}, format="json"
    )
    assert undone.data["today_completed"] is False
    assert undone.data["today_minutes"] == 45

    assert auth_client.patch(f"/api/v1/routines/items/{item_id}/", {"name": ""}, format="json").status_code == 400
    assert auth_client.delete(f"/api/v1/routines/items/{item_id}/").status_code == 204
    assert auth_client.get("/api/v1/routines/business/items/").data["items"] == []


def test_routine_items_are_private(client_for, user, stranger):
    item = client_for(user).post("/api/v1/routines/personal/items/", {"name": "Read"}, format="json").data
    assert (
        client_for(stranger).patch(f"/api/v1/routines/items/{item['id']}/", {"name": "x"}, format="json").status_code
        == 404
    )
    assert client_for(stranger).get("/api/v1/routines/personal/items/").data["items"] == []


def test_rules_reorder(auth_client):
    a = auth_client.post("/api/v1/rules/", {"text": "No phone before 9"}, format="json").data
    b = auth_client.post("/api/v1/rules/", {"text": "Ship daily"}, format="json").data
    assert [r["id"] for r in auth_client.get("/api/v1/rules/").data] == [a["id"], b["id"]]
    assert auth_client.post("/api/v1/rules/reorder/", {"ids": [b["id"], a["id"]]}, format="json").status_code == 204
    assert [r["id"] for r in auth_client.get("/api/v1/rules/").data] == [b["id"], a["id"]]
    assert auth_client.post("/api/v1/rules/", {"text": ""}, format="json").status_code == 400


def test_routine_pauses_on_weekends_unless_opted_in(auth_client, user):
    from apps.accounts.models import UserPreference
    from apps.routines import services

    everyday = auth_client.post("/api/v1/routines/personal/items/", {"name": "Gym"}, format="json").data
    weekend_only = auth_client.post(
        "/api/v1/routines/personal/items/", {"name": "Long run", "repeat_days": 96}, format="json"
    ).data
    saturday, monday = "2026-09-05", "2026-09-07"

    # Default: the everyday block takes the weekend off; a weekend-only block is deliberate and stays.
    res = auth_client.get(f"/api/v1/routines/personal/items/?today=1&date={saturday}")
    assert res.data["paused"] is True
    assert [i["id"] for i in res.data["items"]] == [weekend_only["id"]]

    res = auth_client.get(f"/api/v1/routines/personal/items/?today=1&date={monday}")
    assert res.data["paused"] is False
    assert [i["id"] for i in res.data["items"]] == [everyday["id"]]

    # Opt in: weekends run the full routine again.
    prefs, _ = UserPreference.objects.get_or_create(user=user)
    prefs.routine_on_weekends = True
    prefs.save()
    user.refresh_from_db()
    from datetime import date

    ids = {i.pk for i in services.items_for_day(user, "personal", date.fromisoformat(saturday))}
    assert ids == {everyday["id"], weekend_only["id"]}
    assert services.routine_paused_on(user, date.fromisoformat(saturday)) is False
