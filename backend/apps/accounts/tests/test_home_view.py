"""Per-user home page preference and the set_home_view management command."""

from __future__ import annotations

from io import StringIO

import pytest
from django.core.management import call_command

from apps.accounts.models import UserPreference

pytestmark = pytest.mark.django_db


def test_home_view_defaults_to_dashboard(auth_client):
    me = auth_client.get("/api/v1/auth/me/")
    assert me.status_code == 200
    assert me.data["preferences"]["home_view"] == "dashboard"


def test_home_view_can_be_set_to_projects(auth_client):
    saved = auth_client.patch("/api/v1/auth/me/preferences/", {"home_view": "projects"}, format="json")
    assert saved.status_code == 200, saved.data
    assert saved.data["preferences"]["home_view"] == "projects"


def test_invalid_home_view_is_rejected(auth_client):
    response = auth_client.patch("/api/v1/auth/me/preferences/", {"home_view": "nonsense"}, format="json")
    assert response.status_code == 400


def test_set_home_view_command_by_email(user):
    call_command("set_home_view", user.email, "projects", stdout=StringIO())
    prefs = UserPreference.objects.get(user=user)
    assert prefs.home_view == "projects"

    call_command("set_home_view", user.email, "dashboard", stdout=StringIO())
    prefs.refresh_from_db()
    assert prefs.home_view == "dashboard"
