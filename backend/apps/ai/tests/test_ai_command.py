"""AI command loop with a scripted fake provider: no network, deterministic tool calls."""

from __future__ import annotations

import json

import pytest

from apps.ai import provider as provider_module
from apps.ai.models import AIAction
from apps.ai.provider import LLMResponse, ToolCall
from apps.tasks.models import Task

pytestmark = pytest.mark.django_db


class ScriptedProvider:
    """Returns pre-programmed responses in order; records every request it saw."""

    name = "fake"

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def complete(self, *, system, messages, tools=None, tool_choice=None, max_tokens=1024, temperature=0.2):
        self.calls.append({"system": system, "messages": messages, "tools": tools, "tool_choice": tool_choice})
        if not self.responses:
            return LLMResponse(text="Done.")
        return self.responses.pop(0)


@pytest.fixture
def user(make_user):
    # AI is admins-only, so the acting user in this module is a staff account.
    return make_user("owner@example.com", is_staff=True)


@pytest.fixture
def scripted():
    created = []

    def _install(responses):
        p = ScriptedProvider(responses)
        provider_module.set_provider(p)
        created.append(p)
        return p

    yield _install
    provider_module.set_provider(None)


def test_create_task_via_natural_language(auth_client, user, scripted):
    fake = scripted(
        [
            LLMResponse(
                tool_calls=[
                    ToolCall(
                        id="t1",
                        name="create_task",
                        input={"title": "Call Nino", "when": "tomorrow 15:00", "kind": "business"},
                    )
                ],
                stop_reason="tool_use",
                input_tokens=100,
                output_tokens=20,
            ),
            LLMResponse(text="Added “Call Nino” for tomorrow 15:00."),
        ]
    )
    res = auth_client.post("/api/v1/ai/command/", {"text": "call Nino tomorrow at 15:00 (business)"}, format="json")
    assert res.status_code == 200, res.content
    assert res.data["status"] == "executed"
    assert res.data["changed"] is True
    assert res.data["tool_calls"][0]["status"] == "ok"
    task = Task.objects.get(title="Call Nino")
    assert task.kind == "business"
    assert task.due_at is not None and task.due_has_time is True
    # The model saw the tool result with the created task.
    tool_result = json.loads(fake.calls[1]["messages"][-1]["content"][0]["content"])
    assert tool_result["created"][0]["id"] == task.pk
    action = AIAction.objects.get()
    assert action.input_tokens == 100 and action.status == "executed"
    # Activity records the AI actor.
    feed = auth_client.get("/api/v1/activity/").data["results"]
    assert any(row["name"] == "task.created" and row["actor_kind"] == "ai" for row in feed)


def test_destructive_tool_requires_confirmation(auth_client, user, scripted):
    task = Task.objects.create(owner=user, created_by=user, title="Old thing", kind="personal")
    scripted(
        [
            LLMResponse(
                tool_calls=[ToolCall(id="t1", name="delete_task", input={"task_id": task.pk})], stop_reason="tool_use"
            ),
            LLMResponse(text="Shall I delete “Old thing”?"),
        ]
    )
    res = auth_client.post("/api/v1/ai/command/", {"text": "delete old thing"}, format="json")
    assert res.status_code == 200, res.content
    assert res.data["status"] == "proposed"
    assert res.data["pending"]["preview"]["summary"] == "Delete “Old thing”"
    assert Task.objects.filter(pk=task.pk).exists()

    action_id = res.data["pending_action_id"]
    # Another (admin) user cannot confirm it - ownership is checked, not just the staff gate.
    from rest_framework.test import APIClient

    from apps.accounts.models import User

    stranger = User.objects.create_user(email="x@example.com", password="TestPass!2345", is_staff=True)
    other = APIClient()
    other.force_authenticate(user=stranger)
    assert other.post(f"/api/v1/ai/actions/{action_id}/confirm/").status_code == 404

    ok = auth_client.post(f"/api/v1/ai/actions/{action_id}/confirm/")
    assert ok.status_code == 200, ok.content
    assert not Task.objects.filter(pk=task.pk).exists()
    assert AIAction.objects.get(pk=action_id).status == "executed"
    # Confirming twice is rejected.
    assert auth_client.post(f"/api/v1/ai/actions/{action_id}/confirm/").status_code == 409


def test_tools_respect_visibility(auth_client, user, other_user, scripted):
    foreign = Task.objects.create(owner=other_user, created_by=other_user, title="Not yours", kind="personal")
    scripted(
        [
            LLMResponse(
                tool_calls=[ToolCall(id="t1", name="complete_task", input={"task_id": foreign.pk})],
                stop_reason="tool_use",
            ),
            LLMResponse(text="I couldn't find that task."),
        ]
    )
    res = auth_client.post("/api/v1/ai/command/", {"text": "complete not yours"}, format="json")
    assert res.status_code == 200
    assert res.data["tool_calls"][0]["status"] == "error"
    foreign.refresh_from_db()
    assert foreign.status == "todo"


def test_breakdown_and_apply(auth_client, user, scripted):
    task = Task.objects.create(owner=user, created_by=user, title="Launch site", kind="business")
    scripted(
        [
            LLMResponse(
                tool_calls=[
                    ToolCall(
                        id="t1",
                        name="task_breakdown",
                        input={"subtasks": [{"title": "Write copy", "estimated_minutes": 60}, {"title": "Deploy"}]},
                    )
                ]
            )
        ]
    )
    res = auth_client.post(f"/api/v1/ai/tasks/{task.pk}/breakdown/")
    assert res.status_code == 200, res.content
    assert len(res.data["subtasks"]) == 2
    applied = auth_client.post(
        f"/api/v1/ai/tasks/{task.pk}/breakdown/apply/", {"subtasks": res.data["subtasks"]}, format="json"
    )
    assert applied.status_code == 201
    assert Task.objects.filter(parent=task).count() == 2


def _polished(*rows):
    return LLMResponse(tool_calls=[ToolCall(id="t", name="polished_tasks", input={"tasks": list(rows)})])


def test_polish_rewrites_titles_retries_echoed_drafts_and_skips_foreign_tasks(auth_client, user, make_user, scripted):
    terse = Task.objects.create(
        owner=user, created_by=user, title="ნინისთან შეხვედრა ხვალე ჰიპერბლასტის", kind="business"
    )
    sloppy = Task.objects.create(owner=user, created_by=user, title="fix site bugs lol", kind="business")
    fine = Task.objects.create(
        owner=user, created_by=user, title="Pay rent", description="By the 5th.", kind="personal"
    )
    foreign = Task.objects.create(owner=make_user("x@example.com"), title="secret", kind="personal")
    fake = scripted(
        [
            # First pass: the model edits one draft but copies the other two back verbatim.
            _polished(
                {"id": terse.pk, "title": "შეხვედრა ნინისთან Hyperblast-ის თაობაზე", "description": "შეხვედრა ხვალ."},
                {"id": sloppy.pk, "title": "fix site bugs lol"},
                {"id": fine.pk, "title": "Pay rent", "description": "By the 5th."},
            ),
            # Focused retry gets only the echoed drafts; one is fixed, one still comes back unchanged.
            _polished(
                {"id": sloppy.pk, "title": "Resolve website defects", "description": "Fix the reported bugs."},
                {"id": fine.pk, "title": "Pay rent", "description": "By the 5th."},
            ),
        ]
    )
    res = auth_client.post(
        "/api/v1/ai/tasks/polish/",
        {"task_ids": [terse.pk, sloppy.pk, fine.pk, foreign.pk, terse.pk]},
        format="json",
    )
    assert res.status_code == 200, res.content
    assert len(fake.calls) == 2, "one batch call plus one retry for the echoed drafts"
    assert fake.calls[0]["tool_choice"] == {"type": "tool", "name": "polished_tasks"}
    first, retry = (call["messages"][0]["content"] for call in fake.calls)
    assert f"DRAFT #{terse.pk}:" in first and f"DRAFT #{sloppy.pk}:" in first and f"DRAFT #{fine.pk}:" in first
    assert "returned unchanged on a previous pass" in retry
    assert f"DRAFT #{terse.pk}:" not in retry
    assert f"DRAFT #{sloppy.pk}:" in retry and f"DRAFT #{fine.pk}:" in retry

    assert [row["id"] for row in res.data["updated"]] == [terse.pk, sloppy.pk]
    assert res.data["updated"][0]["previous_title"] == "ნინისთან შეხვედრა ხვალე ჰიპერბლასტის"
    assert res.data["unchanged"] == [fine.pk]
    assert res.data["skipped"] == [foreign.pk]
    terse.refresh_from_db()
    assert terse.title == "შეხვედრა ნინისთან Hyperblast-ის თაობაზე"
    assert terse.description == "შეხვედრა ხვალ."
    sloppy.refresh_from_db()
    assert sloppy.title == "Resolve website defects"
    foreign.refresh_from_db()
    assert foreign.title == "secret"


def test_reply_language_follows_interface_locale(auth_client, user, scripted):
    user.locale = "ka"
    user.save(update_fields=["locale"])
    fake = scripted([LLMResponse(text="გამარჯობა.")])
    auth_client.post("/api/v1/ai/command/", {"text": "hello"}, format="json")
    assert "REPLY LANGUAGE: Georgian." in fake.calls[0]["system"]
    assert "Interface language: Georgian." in fake.calls[0]["system"]
    assert fake.calls[0]["messages"][-1]["content"].endswith("[Answer in Georgian.]")

    user.locale = "en"
    user.save(update_fields=["locale"])
    task = Task.objects.create(owner=user, created_by=user, title="x", kind="personal")
    fake = scripted([LLMResponse(tool_calls=[ToolCall(id="t", name="polished_tasks", input={"tasks": []})])])
    auth_client.post("/api/v1/ai/tasks/polish/", {"task_ids": [task.pk]}, format="json")
    assert "generated text in English" in fake.calls[0]["system"]
    assert "formal, professional English" in fake.calls[0]["messages"][0]["content"]


def test_polish_requires_task_ids(auth_client, scripted):
    scripted([])
    assert auth_client.post("/api/v1/ai/tasks/polish/", {"task_ids": []}, format="json").status_code == 400
    assert auth_client.post("/api/v1/ai/tasks/polish/", {"task_ids": "1"}, format="json").status_code == 400


def test_unconfigured_returns_503(auth_client, settings):
    settings.ANTHROPIC_API_KEY = ""
    res = auth_client.post("/api/v1/ai/command/", {"text": "hello"}, format="json")
    assert res.status_code == 503
    assert res.data["error"]["code"] == "ai_not_configured"
