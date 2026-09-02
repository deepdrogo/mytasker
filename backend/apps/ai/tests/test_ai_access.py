"""AI is an administrators-only capability: REST, /me flag and Telegram routing all enforce it."""

from __future__ import annotations

import pytest

from apps.ai import provider as provider_module
from apps.ai.access import ai_allowed, ai_enabled_for
from apps.ai.provider import LLMResponse
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db

AI_ENDPOINTS = [
    ("post", "/api/v1/ai/command/", {"text": "hello"}),
    ("get", "/api/v1/ai/actions/", None),
    ("post", "/api/v1/ai/actions/1/confirm/", None),
    ("post", "/api/v1/ai/actions/1/reject/", None),
    ("post", "/api/v1/ai/tasks/1/improve/", None),
    ("post", "/api/v1/ai/tasks/1/breakdown/", None),
    ("post", "/api/v1/ai/tasks/1/breakdown/apply/", {"subtasks": []}),
    ("post", "/api/v1/ai/plan-day/", None),
    ("post", "/api/v1/ai/prompts/1/improve/", None),
    ("post", "/api/v1/ai/ideas/1/improve/", None),
]


class _Provider:
    name = "fake"

    def __init__(self):
        self.calls = 0

    def complete(self, **kwargs):
        self.calls += 1
        return LLMResponse(text="Done.")


@pytest.fixture
def fake_provider():
    p = _Provider()
    provider_module.set_provider(p)
    yield p
    provider_module.set_provider(None)


@pytest.mark.parametrize("method,url,body", AI_ENDPOINTS)
def test_non_staff_gets_403_on_every_ai_endpoint(client_for, make_user, method, url, body, fake_provider):
    regular = make_user("regular@example.com")
    client = client_for(regular)
    res = getattr(client, method)(url, body, format="json") if body is not None else getattr(client, method)(url)
    assert res.status_code == 403, (url, res.content)
    assert fake_provider.calls == 0


@pytest.mark.parametrize("method,url,body", AI_ENDPOINTS)
def test_anonymous_gets_401_on_every_ai_endpoint(api, method, url, body):
    res = getattr(api, method)(url, body, format="json") if body is not None else getattr(api, method)(url)
    assert res.status_code in (401, 403), (url, res.content)


def test_staff_can_use_ai(client_for, make_user, fake_provider):
    admin = make_user("admin@example.com", is_staff=True)
    res = client_for(admin).post("/api/v1/ai/command/", {"text": "hello"}, format="json")
    assert res.status_code == 200, res.content
    assert fake_provider.calls == 1


def test_status_is_visible_to_everyone_signed_in_and_reports_allowed(client_for, make_user, fake_provider):
    regular = make_user("regular@example.com")
    admin = make_user("admin@example.com", is_staff=True)
    r1 = client_for(regular).get("/api/v1/ai/status/")
    r2 = client_for(admin).get("/api/v1/ai/status/")
    assert r1.status_code == 200 and r1.data == {"configured": True, "allowed": False, "enabled": False}
    assert r2.status_code == 200 and r2.data == {"configured": True, "allowed": True, "enabled": True}


def test_me_exposes_ai_enabled_only_for_staff(client_for, make_user, fake_provider):
    regular = make_user("regular@example.com")
    admin = make_user("admin@example.com", is_staff=True)
    assert client_for(regular).get("/api/v1/auth/me/").data["ai_enabled"] is False
    assert client_for(admin).get("/api/v1/auth/me/").data["ai_enabled"] is True


def test_me_ai_enabled_false_when_provider_unconfigured(client_for, make_user, settings):
    settings.ANTHROPIC_API_KEY = ""
    admin = make_user("admin@example.com", is_staff=True)
    assert client_for(admin).get("/api/v1/auth/me/").data["ai_enabled"] is False


def test_access_helpers(make_user, fake_provider):
    regular = make_user("regular@example.com")
    admin = make_user("admin@example.com", is_staff=True)
    inactive_admin = make_user("old@example.com", is_staff=True, is_active=False)
    assert ai_allowed(regular) is False
    assert ai_allowed(admin) is True
    assert ai_allowed(inactive_admin) is False
    assert ai_allowed(None) is False
    assert ai_enabled_for(admin) is True


def test_telegram_free_text_falls_back_to_quick_add_for_non_staff(make_user, fake_provider):
    from apps.telegram.commands import natural_language

    regular = make_user("regular@example.com")
    reply, _markup = natural_language(regular, "Buy milk tomorrow")
    assert fake_provider.calls == 0
    assert Task.objects.filter(owner=regular, title__icontains="Buy milk").exists()
    assert reply


def test_telegram_free_text_uses_ai_for_staff(make_user, fake_provider):
    from apps.telegram.commands import natural_language

    admin = make_user("admin@example.com", is_staff=True)
    reply, _markup = natural_language(admin, "what's on my plate today?")
    assert fake_provider.calls == 1
    assert "Done." in reply
