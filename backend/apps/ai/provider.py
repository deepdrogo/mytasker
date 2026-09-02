# MyTasker — LLM provider adapter (admin-only feature).
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

"""
LLM provider abstraction. The rest of the AI layer only sees `LLMProvider`; Anthropic specifics
live here so the model/vendor can be swapped (or faked in tests) without touching tools/services.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

from django.conf import settings

logger = logging.getLogger("mytasker.ai")


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class LLMResponse:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop_reason: str = "end_turn"
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""

    @property
    def wants_tools(self) -> bool:
        return bool(self.tool_calls)


class LLMError(Exception):
    pass


class LLMNotConfigured(LLMError):
    pass


class LLMProvider(Protocol):
    name: str

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: dict[str, Any] | None = None,
        max_tokens: int = 1024,
        temperature: float = 0.2,
    ) -> LLMResponse: ...


_sdk_params: frozenset[str] | None = None


def _sdk_accepts(param: str) -> bool:
    """Whether the installed anthropic SDK's `messages.create` still takes this keyword."""
    global _sdk_params
    if _sdk_params is None:
        import inspect

        import anthropic

        try:
            _sdk_params = frozenset(inspect.signature(anthropic.resources.messages.Messages.create).parameters)
        except (TypeError, ValueError, AttributeError):  # pragma: no cover - defensive
            _sdk_params = frozenset()
    return param in _sdk_params


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str | None = None, model: str | None = None, timeout: float | None = None):
        self.api_key = api_key or settings.ANTHROPIC_API_KEY
        self.model = model or settings.ANTHROPIC_MODEL
        self.timeout = timeout or settings.ANTHROPIC_TIMEOUT_SECONDS
        self._client = None

    @property
    def client(self):
        if self._client is None:
            if not self.api_key:
                raise LLMNotConfigured("ANTHROPIC_API_KEY is not configured.")
            import anthropic

            self._client = anthropic.Anthropic(api_key=self.api_key, timeout=self.timeout, max_retries=2)
        return self._client

    def complete(
        self, *, system, messages, tools=None, tool_choice=None, max_tokens=1024, temperature=0.2
    ) -> LLMResponse:
        import anthropic

        params: dict[str, Any] = {
            "model": self.model,
            "system": system,
            "messages": messages,
            "max_tokens": max_tokens,
        }
        # Newer SDK/API generations dropped `temperature`; only send it where it is still accepted.
        if _sdk_accepts("temperature"):
            params["temperature"] = temperature
        if tools:
            params["tools"] = tools
        if tool_choice:
            params["tool_choice"] = tool_choice
        try:
            response = self.client.messages.create(**params)
        except anthropic.RateLimitError as exc:
            raise LLMError("The AI service is busy. Try again in a moment.") from exc
        except anthropic.APIStatusError as exc:
            logger.warning("anthropic error %s: %s", exc.status_code, exc.message)
            raise LLMError("The AI service returned an error.") from exc
        except anthropic.APIConnectionError as exc:
            raise LLMError("Could not reach the AI service.") from exc

        out = LLMResponse(stop_reason=response.stop_reason or "end_turn", model=response.model)
        for block in response.content:
            if block.type == "text":
                out.text += block.text
            elif block.type == "tool_use":
                out.tool_calls.append(ToolCall(id=block.id, name=block.name, input=dict(block.input or {})))
        usage = getattr(response, "usage", None)
        if usage is not None:
            out.input_tokens = int(getattr(usage, "input_tokens", 0) or 0)
            out.output_tokens = int(getattr(usage, "output_tokens", 0) or 0)
        return out


_override: LLMProvider | None = None


def set_provider(provider: LLMProvider | None) -> None:
    """Test hook / future multi-provider switch."""
    global _override
    _override = provider


def get_provider() -> LLMProvider:
    if _override is not None:
        return _override
    return AnthropicProvider()


def is_configured() -> bool:
    return _override is not None or bool(settings.ANTHROPIC_API_KEY)
