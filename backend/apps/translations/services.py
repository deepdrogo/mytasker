# MyTasker — translation orchestration: what to translate, when, and who hears about it.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.ai.provider import LLMError, is_configured
from apps.realtime import publisher
from apps.translations.models import Translation
from apps.translations.registry import MAX_FIELD_CHARS, REGISTRY, Translatable, get_spec, select_related_for
from apps.translations.translator import translate_payload

logger = logging.getLogger("mytasker.translations")

MAX_ATTEMPTS = 3
MAX_LOOKUP_KEYS = 200
# A pending row younger than this is assumed to have a live job; older ones are re-enqueued on demand.
PENDING_GRACE_SECONDS = 5 * 60


def enabled() -> bool:
    return bool(getattr(settings, "TRANSLATIONS_ENABLED", True)) and is_configured()


# ------------------------------------------------------------------------------- source payload


def source_payload(spec: Translatable, obj) -> dict[str, str]:
    """Non-empty, size-capped text fields of `obj` in registry order."""
    payload: dict[str, str] = {}
    for name in spec.fields:
        value = getattr(obj, name, None)
        if isinstance(value, str):
            text = value.strip()
            if text and len(text) <= MAX_FIELD_CHARS:
                payload[name] = text
    return payload


def compute_hash(payload: dict[str, str]) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _load(spec: Translatable, target_id: int):
    qs = spec.queryset()
    related = select_related_for(spec)
    if related:
        qs = qs.select_related(*related)
    return qs.filter(pk=target_id).first()


# ------------------------------------------------------------------------------- requesting


def request_translation(target_type: str, target_id: int, *, force: bool = False) -> Translation | None:
    """
    Ensure a translation job exists for the object. Idempotent: an object whose text has not changed
    since its last successful translation is never re-translated. Safe to call inside a transaction -
    the Celery job is enqueued after commit.
    """
    spec = get_spec(target_type)
    if spec is None or not enabled():
        return None
    obj = _load(spec, target_id)
    if obj is None:
        Translation.objects.filter(target_type=target_type, target_id=target_id).delete()
        return None
    payload = source_payload(spec, obj)
    if not payload:
        Translation.objects.filter(target_type=target_type, target_id=target_id).delete()
        return None
    return _ensure_job(spec, obj.pk, compute_hash(payload), force=force)


def _ensure_job(spec: Translatable, target_id: int, source_hash: str, *, force: bool = False) -> Translation:
    row, _created = Translation.objects.get_or_create(
        target_type=spec.type,
        target_id=target_id,
        defaults={"source_hash": source_hash, "status": Translation.Status.PENDING},
    )
    if not _created:
        same_source = row.source_hash == source_hash
        if same_source and not force:
            if row.status == Translation.Status.READY:
                return row
            if row.status == Translation.Status.FAILED and row.attempts >= MAX_ATTEMPTS:
                return row
            age = (timezone.now() - row.updated_at).total_seconds()
            # A job is already queued/running for exactly this text - do not pile up duplicates.
            if row.status == Translation.Status.PENDING and age < (PENDING_GRACE_SECONDS if row.attempts else 60):
                return row
        else:
            row.source_hash = source_hash
            row.attempts = 0
        row.status = Translation.Status.PENDING
        row.error = ""
        row.save(update_fields=["source_hash", "status", "error", "attempts", "updated_at"])
    _enqueue(spec.type, target_id)
    return row


def _enqueue(target_type: str, target_id: int) -> None:
    def _send() -> None:
        from apps.translations.tasks import translate_object

        try:
            translate_object.delay(target_type, target_id)
        except Exception:  # pragma: no cover - broker down must never break the request
            logger.exception("could not enqueue translation", extra={"target": f"{target_type}:{target_id}"})

    transaction.on_commit(_send)


# ------------------------------------------------------------------------------- running


class RetryLater(Exception):
    """Raised by run_translation when the provider failed but another attempt is allowed."""


def run_translation(target_type: str, target_id: int) -> Translation | None:
    """Celery body. Translates the current text of the object and publishes the result."""
    spec = get_spec(target_type)
    if spec is None:
        return None
    obj = _load(spec, target_id)
    row = Translation.objects.filter(target_type=target_type, target_id=target_id).first()
    if obj is None:
        if row is not None:
            row.delete()
        return None
    payload = source_payload(spec, obj)
    if not payload:
        if row is not None:
            row.delete()
        return None
    source_hash = compute_hash(payload)
    if row is None:
        row = Translation.objects.create(target_type=target_type, target_id=target_id, source_hash=source_hash)
    if row.status == Translation.Status.READY and row.source_hash == source_hash:
        return row  # duplicate job; nothing to do
    if row.status == Translation.Status.FAILED and row.source_hash == source_hash and row.attempts >= MAX_ATTEMPTS:
        return row

    row.source_hash = source_hash
    row.status = Translation.Status.PENDING
    row.attempts += 1
    row.save(update_fields=["source_hash", "status", "attempts", "updated_at"])

    try:
        result = translate_payload(payload)
    except LLMError as exc:
        failed = row.attempts >= MAX_ATTEMPTS
        Translation.objects.filter(pk=row.pk, source_hash=source_hash).update(
            status=Translation.Status.FAILED if failed else Translation.Status.PENDING,
            error=str(exc)[:300],
            updated_at=timezone.now(),
        )
        if failed:
            logger.warning("translation failed permanently", extra={"target": f"{target_type}:{target_id}"})
            _publish(spec, obj, {"status": "failed"})
            return None
        raise RetryLater(str(exc)) from exc

    # Only persist if nobody re-pointed the row at newer text while we were translating.
    updated = Translation.objects.filter(pk=row.pk, source_hash=source_hash).update(
        status=Translation.Status.READY,
        source_lang=result.source_lang,
        translations=result.translations,
        error="",
        input_tokens=result.input_tokens,
        output_tokens=result.output_tokens,
        updated_at=timezone.now(),
    )
    if not updated:
        return None
    row.refresh_from_db()
    _publish(spec, obj, _ready_payload(row))

    # The text may have changed under us; make sure the newest version gets translated too.
    fresh = _load(spec, target_id)
    if fresh is not None:
        fresh_payload = source_payload(spec, fresh)
        if fresh_payload and compute_hash(fresh_payload) != source_hash:
            _ensure_job(spec, target_id, compute_hash(fresh_payload))
    return row


def _ready_payload(row: Translation) -> dict[str, Any]:
    return {"status": "ready", "source_lang": row.source_lang, "translations": row.translations}


def _publish(spec: Translatable, obj, body: dict[str, Any]) -> None:
    audience = spec.audience(obj)
    payload = {"type": "translation", "key": f"{spec.type}:{obj.pk}", **body}
    publisher.publish_to_users(audience.user_ids, payload)
    if audience.project_id:
        publisher.publish_to_project(audience.project_id, payload)


# ------------------------------------------------------------------------------- reading


def lookup(user, keys: list[str]) -> dict[str, dict[str, Any]]:
    """
    Resolve translations for `keys` ("task:12", "project:3", ...) the user may see. Objects without a
    fresh translation are queued on the spot, so simply looking at content backfills it over time.
    """
    grouped: dict[str, set[int]] = {}
    for key in keys[:MAX_LOOKUP_KEYS]:
        target_type, _, raw_id = str(key).partition(":")
        if target_type in REGISTRY and raw_id.isdigit():
            grouped.setdefault(target_type, set()).add(int(raw_id))

    result: dict[str, dict[str, Any]] = {}
    active = enabled()
    for target_type, ids in grouped.items():
        spec = REGISTRY[target_type]
        qs = spec.visible_queryset(user).filter(pk__in=ids)
        related = select_related_for(spec)
        if related:
            qs = qs.select_related(*related)
        objects = list(qs)
        rows = {
            row.target_id: row
            for row in Translation.objects.filter(target_type=target_type, target_id__in=[o.pk for o in objects])
        }
        for obj in objects:
            key = f"{target_type}:{obj.pk}"
            payload = source_payload(spec, obj)
            if not payload:
                result[key] = {"status": "none"}
                continue
            source_hash = compute_hash(payload)
            row = rows.get(obj.pk)
            if row is not None and row.source_hash == source_hash and row.status == Translation.Status.READY:
                result[key] = _ready_payload(row)
            elif (
                row is not None
                and row.source_hash == source_hash
                and row.status == Translation.Status.FAILED
                and row.attempts >= MAX_ATTEMPTS
            ):
                result[key] = {"status": "failed"}
            elif not active:
                result[key] = {"status": "none"}
            else:
                _ensure_job(spec, obj.pk, source_hash)
                result[key] = {"status": "pending"}
    return result


# ------------------------------------------------------------------------------- backfill


def backfill_for_user(user_id: int, *, limit: int = 500) -> int:
    """Queue translations for the user's most recent content that has no fresh translation yet."""
    from django.contrib.auth import get_user_model

    user = get_user_model().objects.filter(pk=user_id, is_active=True).first()
    if user is None or not enabled():
        return 0
    queued = 0
    for spec in REGISTRY.values():
        if queued >= limit:
            break
        qs = spec.visible_queryset(user).order_by("-pk")
        related = select_related_for(spec)
        if related:
            qs = qs.select_related(*related)
        for obj in qs[: limit - queued]:
            payload = source_payload(spec, obj)
            if not payload:
                continue
            source_hash = compute_hash(payload)
            row = Translation.objects.filter(target_type=spec.type, target_id=obj.pk).first()
            if row is not None and row.source_hash == source_hash and row.status != Translation.Status.PENDING:
                continue
            _ensure_job(spec, obj.pk, source_hash)
            queued += 1
    return queued
