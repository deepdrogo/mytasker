"""Preferences: partial updates, clearing nullable settings, and Crypto world's place on the timeline."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db

URL = "/api/v1/auth/me/preferences/"


def test_crypto_world_can_be_scheduled_moved_and_taken_off(auth_client):
    placed = auth_client.patch(
        URL, {"crypto_world_start": "2030-03-01", "crypto_world_end": "2030-03-10"}, format="json"
    )
    assert placed.status_code == 200, placed.data
    prefs = placed.data["preferences"]
    assert (prefs["crypto_world_start"], prefs["crypto_world_end"]) == ("2030-03-01", "2030-03-10")

    open_ended = auth_client.patch(URL, {"crypto_world_start": "2030-03-05", "crypto_world_end": None}, format="json")
    prefs = open_ended.data["preferences"]
    assert (prefs["crypto_world_start"], prefs["crypto_world_end"]) == ("2030-03-05", None)

    # Taking the start away takes the whole span off the calendar, even if an end is still sent.
    auth_client.patch(URL, {"crypto_world_end": "2030-03-20"}, format="json")
    removed = auth_client.patch(URL, {"crypto_world_start": None, "crypto_world_end": "2030-03-20"}, format="json")
    prefs = removed.data["preferences"]
    assert (prefs["crypto_world_start"], prefs["crypto_world_end"]) == (None, None)


def test_crypto_world_end_cannot_precede_start(auth_client):
    response = auth_client.patch(
        URL, {"crypto_world_start": "2030-03-10", "crypto_world_end": "2030-03-01"}, format="json"
    )
    assert response.status_code == 400


def test_other_preferences_leave_crypto_world_alone(auth_client):
    auth_client.patch(URL, {"crypto_world_start": "2030-03-01", "crypto_world_end": None}, format="json")
    saved = auth_client.patch(URL, {"time_format": "12h", "planned_bedtime": None}, format="json")
    prefs = saved.data["preferences"]
    assert prefs["time_format"] == "12h"
    assert prefs["crypto_world_start"] == "2030-03-01"


def test_null_clears_optional_settings_but_not_required_ones(auth_client):
    auth_client.patch(URL, {"planned_bedtime": "23:30"}, format="json")
    cleared = auth_client.patch(URL, {"planned_bedtime": None}, format="json")
    assert cleared.status_code == 200
    assert cleared.data["preferences"]["planned_bedtime"] is None
