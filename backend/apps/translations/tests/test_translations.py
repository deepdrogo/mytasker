"""Background translation: hashing, idempotency, visibility, lookup API and realtime payloads."""

from __future__ import annotations

import json

import pytest

from apps.ai import provider as provider_module
from apps.ai.provider import LLMError, LLMResponse, ToolCall
from apps.tasks import services as task_services
from apps.translations import services
from apps.translations.models import Translation
from apps.translations.translator import TOOL_NAME
from common.actors import Actor

pytestmark = pytest.mark.django_db


class FakeTranslator:
    """Echo translator: prefixes every value with the target language so results are recognisable."""

    name = "fake"

    def __init__(self, source_lang="ka", fail_times=0):
        self.source_lang = source_lang
        self.fail_times = fail_times
        self.calls = []

    def complete(self, *, system, messages, tools=None, tool_choice=None, max_tokens=1024, temperature=0.2):
        payload = json.loads(messages[0]["content"])
        self.calls.append(payload)
        if self.fail_times > 0:
            self.fail_times -= 1
            raise LLMError("busy")
        translations = {
            code: {k: f"[{code}] {v}" for k, v in payload.items()}
            for code in ("ka", "en")
            if code != self.source_lang
        }
        return LLMResponse(
            tool_calls=[
                ToolCall(
                    id="t", name=TOOL_NAME, input={"source_lang": self.source_lang, "translations": translations}
                )
            ],
            stop_reason="tool_use",
            input_tokens=10,
            output_tokens=20,
        )


@pytest.fixture
def translator(settings):
    settings.TRANSLATIONS_ENABLED = True
    fake = FakeTranslator()
    provider_module.set_provider(fake)
    yield fake
    provider_module.set_provider(None)


@pytest.fixture
def commit(django_capture_on_commit_callbacks):
    return django_capture_on_commit_callbacks


def _actor(user) -> Actor:
    return Actor.from_user(user)


def test_task_create_triggers_translation_and_edit_retranslates(user, translator, commit):
    with commit(execute=True):
        task = task_services.create_task(_actor(user), title="დარეკე ნინოს", description="ხვალ 15:00")
    row = Translation.objects.get(target_type="task", target_id=task.pk)
    assert row.status == Translation.Status.READY
    assert row.source_lang == "ka"
    assert row.translations["en"]["title"] == "[en] დარეკე ნინოს"
    assert "ka" not in row.translations
    assert len(translator.calls) == 1

    # Same text again -> no new provider call.
    with commit(execute=True):
        services.request_translation("task", task.pk)
    assert len(translator.calls) == 1

    # Editing the title changes the hash and re-translates.
    with commit(execute=True):
        task_services.update_task(_actor(user), task.pk, title="დარეკე გიორგის")
    row.refresh_from_db()
    assert row.translations["en"]["title"] == "[en] დარეკე გიორგის"
    assert len(translator.calls) == 2


def test_lookup_returns_ready_and_queues_missing(auth_client, user, translator, commit, make_project):
    project = make_project(user, name="Website redesign")
    with commit(execute=True):
        res = auth_client.post(
            "/api/v1/translations/lookup/", {"keys": [f"project:{project.pk}", "task:999"]}, format="json"
        )
    assert res.status_code == 200, res.content
    key = f"project:{project.pk}"
    # Celery is eager in tests, so the job ran inside the on_commit callback and a second lookup is ready.
    res = auth_client.post("/api/v1/translations/lookup/", {"keys": [key]}, format="json")
    item = res.data["items"][key]
    assert item["status"] == "ready"
    assert item["translations"]["en"]["name"] == "[en] Website redesign"
    assert "task:999" not in res.data["items"]


def test_lookup_respects_visibility(client_for, user, stranger, translator, make_project):
    project = make_project(user, name="Secret")
    res = client_for(stranger).post(
        "/api/v1/translations/lookup/", {"keys": [f"project:{project.pk}"]}, format="json"
    )
    assert res.status_code == 200
    assert res.data["items"] == {}
    assert not Translation.objects.filter(target_type="project", target_id=project.pk).exists()


def test_failure_marks_failed_after_max_attempts(user, translator, make_project):
    translator.fail_times = 99
    project = make_project(user, name="Flaky")
    row = Translation.objects.create(target_type="project", target_id=project.pk, source_hash="x")
    for _ in range(services.MAX_ATTEMPTS):
        try:
            services.run_translation("project", project.pk)
        except services.RetryLater:
            pass
    row.refresh_from_db()
    assert row.status == Translation.Status.FAILED
    assert row.attempts == services.MAX_ATTEMPTS
    # A permanently failed row is reported as failed and not re-queued by lookups.
    result = services.lookup(user, [f"project:{project.pk}"])
    assert result[f"project:{project.pk}"]["status"] == "failed"
    assert len(translator.calls) == services.MAX_ATTEMPTS


def test_source_language_row_serves_original(user, translator, commit):
    translator.source_lang = "en"
    with commit(execute=True):
        task = task_services.create_task(_actor(user), title="Call Nino")
    row = Translation.objects.get(target_type="task", target_id=task.pk)
    assert row.for_lang("en") == {}
    assert row.for_lang("ka")["title"] == "[ka] Call Nino"


def test_disabled_translations_never_call_provider(user, settings, commit):
    settings.TRANSLATIONS_ENABLED = False
    fake = FakeTranslator()
    provider_module.set_provider(fake)
    try:
        with commit(execute=True):
            task_services.create_task(_actor(user), title="Quiet")
        assert fake.calls == []
        assert Translation.objects.count() == 0
    finally:
        provider_module.set_provider(None)


def test_locale_must_be_supported(auth_client):
    assert auth_client.patch("/api/v1/auth/me/", {"locale": "fr"}, format="json").status_code == 400
    res = auth_client.patch("/api/v1/auth/me/", {"locale": "ka"}, format="json")
    assert res.status_code == 200, res.content
    assert res.data["locale"] == "ka"
