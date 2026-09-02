"""Thin httpx wrapper around the Telegram Bot API. All network I/O for Telegram goes through here."""

from __future__ import annotations

import logging
from typing import Any

import httpx
from django.conf import settings

logger = logging.getLogger("mytasker.telegram")


class TelegramError(Exception):
    def __init__(
        self, message: str, *, status_code: int | None = None, retry_after: int | None = None, permanent: bool = False
    ):
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after
        self.permanent = permanent


class TelegramClient:
    def __init__(self, token: str | None = None, timeout: float = 10.0):
        self.token = token if token is not None else settings.TELEGRAM_BOT_TOKEN
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.token)

    def _url(self, method: str) -> str:
        return f"https://api.telegram.org/bot{self.token}/{method}"

    def call(self, method: str, **params: Any) -> Any:
        if not self.configured:
            raise TelegramError("Telegram bot token is not configured.", permanent=True)
        payload = {k: v for k, v in params.items() if v is not None}
        try:
            response = httpx.post(self._url(method), json=payload, timeout=self.timeout)
        except httpx.HTTPError as exc:
            raise TelegramError(f"network error: {exc}") from exc
        try:
            data = response.json()
        except ValueError as exc:
            raise TelegramError(
                f"invalid response ({response.status_code})", status_code=response.status_code
            ) from exc
        if response.status_code == 200 and data.get("ok"):
            return data.get("result")
        description = str(data.get("description", "unknown error"))[:200]
        retry_after = (data.get("parameters") or {}).get("retry_after")
        # 400 (bad request/blocked chat) and 403 (bot blocked by user) are not retryable.
        permanent = response.status_code in (400, 401, 403, 404)
        raise TelegramError(
            description, status_code=response.status_code, retry_after=retry_after, permanent=permanent
        )

    # ---- convenience -------------------------------------------------------
    def send_message(
        self,
        chat_id: int,
        text: str,
        *,
        parse_mode: str = "HTML",
        reply_markup: dict | None = None,
        disable_notification: bool = False,
    ) -> dict:
        return self.call(
            "sendMessage",
            chat_id=chat_id,
            text=text[:4096],
            parse_mode=parse_mode,
            reply_markup=reply_markup,
            disable_web_page_preview=True,
            disable_notification=disable_notification,
        )

    def edit_message_text(
        self, chat_id: int, message_id: int, text: str, *, parse_mode: str = "HTML", reply_markup: dict | None = None
    ) -> dict:
        return self.call(
            "editMessageText",
            chat_id=chat_id,
            message_id=message_id,
            text=text[:4096],
            parse_mode=parse_mode,
            reply_markup=reply_markup,
            disable_web_page_preview=True,
        )

    def answer_callback_query(self, callback_query_id: str, text: str = "", show_alert: bool = False) -> None:
        self.call(
            "answerCallbackQuery", callback_query_id=callback_query_id, text=text[:200] or None, show_alert=show_alert
        )

    def set_webhook(self, url: str, secret_token: str) -> Any:
        return self.call(
            "setWebhook",
            url=url,
            secret_token=secret_token,
            allowed_updates=["message", "callback_query"],
            drop_pending_updates=False,
        )

    def set_my_commands(self, commands: list[dict[str, str]]) -> Any:
        return self.call("setMyCommands", commands=commands)


client = TelegramClient()
