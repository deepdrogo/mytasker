"""
Claude-backed translator. Detects the source language of a small JSON document of user text and
returns the same document in every other supported language. Structured output is enforced through
a forced tool call so the response is always machine-readable.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

from django.conf import settings

from apps.ai.provider import AnthropicProvider, LLMError, LLMProvider, get_provider

logger = logging.getLogger("mytasker.translations")

LANGUAGE_NAMES = {"ka": "Georgian", "en": "English"}

TOOL_NAME = "submit_translation"


@dataclass
class TranslationResult:
    source_lang: str
    translations: dict[str, dict[str, str]] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0


def supported_languages() -> list[str]:
    return list(settings.SUPPORTED_LANGUAGES)


def _system_prompt(target_langs: list[str]) -> str:
    names = ", ".join(f"{LANGUAGE_NAMES.get(code, code)} ({code})" for code in target_langs)
    return (
        "You are the translation engine inside MyTasker, a personal task and project manager. "
        "The user gives you a JSON object whose values are short pieces of text they wrote themselves: task titles, "
        "descriptions, project names, notes, comments, routine items or personal rules.\n\n"
        f"Supported languages: {names}.\n\n"
        "Rules:\n"
        "1. Detect the dominant language of the values. Report it as an ISO 639-1 code; use 'other' if it is "
        "none of the supported languages.\n"
        "2. Translate every value into every supported language EXCEPT the detected source language. Never "
        "include the source language in `translations`. If the source is 'other', translate into all supported "
        "languages.\n"
        "3. Keep the meaning, tone and register. Georgian output must be natural, modern Georgian as a native "
        "speaker would write in a to-do app; English output must be concise, natural English.\n"
        "4. Preserve markdown, line breaks, bullet structure, URLs, emails, code, numbers, dates, times, emojis, "
        "hashtags, @mentions and product or brand names exactly. Do not translate proper names of people or "
        "companies.\n"
        "5. Keep every key exactly as given and never add, drop or merge keys. Never leave a translated value "
        "empty when the source value is non-empty.\n"
        "6. Do not explain, do not add notes. Only call the tool."
    )


def _tool_schema(fields: list[str], target_langs: list[str]) -> dict:
    per_lang = {
        "type": "object",
        "properties": {name: {"type": "string"} for name in fields},
        "required": list(fields),
        "additionalProperties": False,
    }
    return {
        "name": TOOL_NAME,
        "description": "Submit the detected source language and the translations of the given fields.",
        "input_schema": {
            "type": "object",
            "properties": {
                "source_lang": {
                    "type": "string",
                    "description": "ISO 639-1 code of the detected source language, or 'other'.",
                },
                "translations": {
                    "type": "object",
                    "description": "Map of target language code -> translated fields. Omit the source language.",
                    "properties": dict.fromkeys(target_langs, per_lang),
                    "additionalProperties": False,
                },
            },
            "required": ["source_lang", "translations"],
            "additionalProperties": False,
        },
    }


def _budget(payload: dict[str, str], target_count: int) -> int:
    chars = sum(len(v) for v in payload.values())
    # Georgian is token-heavy (roughly one token per character); allow that for every target language.
    return max(512, min(16_000, 256 + chars * (target_count + 1)))


def _provider() -> LLMProvider:
    provider = get_provider()
    model = getattr(settings, "TRANSLATION_MODEL", "") or ""
    if model and isinstance(provider, AnthropicProvider) and provider.model != model:
        return AnthropicProvider(model=model)
    return provider


def translate_payload(payload: dict[str, str], target_langs: list[str] | None = None) -> TranslationResult:
    """
    Translate `payload` (field -> source text) into every supported language other than the detected one.
    Raises LLMError on provider failure or malformed output so the Celery task can retry.
    """
    langs = target_langs or supported_languages()
    if not payload:
        return TranslationResult(source_lang="", translations={})

    fields = list(payload.keys())
    response = _provider().complete(
        system=_system_prompt(langs),
        messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        tools=[_tool_schema(fields, langs)],
        tool_choice={"type": "tool", "name": TOOL_NAME},
        max_tokens=_budget(payload, len(langs)),
        temperature=0.0,
    )
    call = next((c for c in response.tool_calls if c.name == TOOL_NAME), None)
    if call is None:
        raise LLMError("Translator returned no structured result.")

    source_lang = str(call.input.get("source_lang") or "").strip().lower()[:8] or "other"
    raw = call.input.get("translations") or {}
    if not isinstance(raw, dict):
        raise LLMError("Translator returned malformed translations.")

    translations: dict[str, dict[str, str]] = {}
    for code in langs:
        if code == source_lang:
            continue
        block = raw.get(code)
        if not isinstance(block, dict):
            raise LLMError(f"Translator omitted language '{code}'.")
        cleaned: dict[str, str] = {}
        for name in fields:
            value = block.get(name)
            if not isinstance(value, str) or not value.strip():
                raise LLMError(f"Translator returned empty '{name}' for '{code}'.")
            cleaned[name] = value.strip()
        translations[code] = cleaned

    return TranslationResult(
        source_lang=source_lang,
        translations=translations,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
    )
