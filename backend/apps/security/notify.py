"""
Security news for the owner, delivered by the security Telegram bot. Formatting lives here; delivery is a Celery
task (`tasks.send_alert`) so a slow Telegram never slows a request down.
"""

from __future__ import annotations

import logging
from html import escape

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

logger = logging.getLogger("mytasker.security")

PENDING_KEY = "sec:bot:pending"
PENDING_MAX = 40
SEVERITY_ICON = {"info": "ℹ️", "low": "🟡", "medium": "🟠", "high": "🔴", "critical": "🚨"}


def configured() -> bool:
    return bool(getattr(settings, "SECURITY_BOT_TOKEN", ""))


def send(
    text: str,
    *,
    buttons: list[list[dict]] | None = None,
    dedupe: str | None = None,
    ttl: int = 600,
    silent: bool = False,
) -> None:
    if not configured():
        return
    if dedupe:
        try:
            if not cache.add(f"sec:alert:{dedupe}", 1, ttl):
                return
        except Exception:  # noqa: BLE001
            pass
    markup = {"inline_keyboard": buttons} if buttons else None
    try:
        from apps.security.tasks import send_alert

        send_alert.delay(text, markup, silent)
    except Exception:  # noqa: BLE001 - broker down: try once inline, never raise
        logger.warning("alert enqueue failed, sending inline")
        try:
            deliver(text, markup, silent)
        except Exception:  # noqa: BLE001
            logger.exception("inline alert failed")


def deliver(text: str, markup: dict | None = None, silent: bool = False) -> bool:
    """Send to the bound owner now. Before the owner has pressed /start, alerts wait in a short queue."""
    from apps.security.models import SecurityBotState
    from apps.telegram.client import TelegramClient

    state = SecurityBotState.load()
    if not state.owner_chat_id:
        queue = cache.get(PENDING_KEY) or []
        queue.append({"text": text, "markup": markup})
        cache.set(PENDING_KEY, queue[-PENDING_MAX:], 14 * 24 * 3600)
        return False
    TelegramClient(token=settings.SECURITY_BOT_TOKEN).send_message(
        state.owner_chat_id, text, reply_markup=markup, disable_notification=silent
    )
    return True


def flush_pending() -> int:
    queue = cache.get(PENDING_KEY) or []
    cache.delete(PENDING_KEY)
    sent = 0
    for item in queue:
        try:
            if deliver(item["text"], item.get("markup")):
                sent += 1
        except Exception:  # noqa: BLE001
            logger.exception("pending alert failed")
    return sent


# ------------------------------------------------------------------------------------------- formatting


def _when() -> str:
    return timezone.localtime().strftime("%Y-%m-%d %H:%M:%S UTC")


def _ip_line(ip: str | None) -> str:
    return f"🌐 IP: <code>{escape(ip or '?')}</code>"


def ip_buttons(ip: str) -> list[list[dict]]:
    return [
        [
            {"text": "🔒 დაბლოკვა", "callback_data": f"ban:{ip}"[:64]},
            {"text": "🔎 IP ინფო", "callback_data": f"ipinfo:{ip}"[:64]},
        ]
    ]


def event_alert(*, kind: str, ip: str, path: str, ua: str, details: dict, user=None) -> None:
    from apps.security.guard import KIND_TITLES

    lines = [f"🛡 <b>{escape(KIND_TITLES.get(kind, kind))}</b>", _ip_line(ip)]
    if path:
        lines.append(f"📍 <code>{escape(path[:200])}</code>")
    if ua:
        lines.append(f"🧾 UA: <code>{escape(ua[:150])}</code>")
    if user is not None:
        lines.append(f"👤 {escape(getattr(user, 'email', str(user)))}")
    for key, value in list(details.items())[:4]:
        lines.append(f"• {escape(str(key))}: <code>{escape(str(value)[:150])}</code>")
    lines.append(f"🕒 {_when()}")
    send("\n".join(lines), buttons=ip_buttons(ip), dedupe=f"evt:{kind}:{ip}", ttl=600)


def ban_alert(row, *, ip: str, trigger: str = "") -> None:
    until = (
        "სამუდამოდ" if row.expires_at is None else timezone.localtime(row.expires_at).strftime("%Y-%m-%d %H:%M UTC")
    )
    text = "\n".join(
        [
            "🚫 <b>IP დაიბლოკა</b>",
            f"🌐 <code>{escape(row.network)}</code>",
            f"📝 {escape(row.reason)}",
            f"⏳ ვადა: {until} · დარღვევა #{row.offenses}",
            f"🕒 {_when()}",
        ]
    )
    buttons = [
        [
            {"text": "✅ განბლოკვა", "callback_data": f"unban:{row.network}"[:64]},
            {"text": "♾ სამუდამოდ", "callback_data": f"perm:{row.network}"[:64]},
        ]
    ]
    send(text, buttons=buttons, dedupe=f"ban:{row.network}:{row.offenses}", ttl=300)


def signup_alert(user, *, ip: str | None, ua: str, country: str, same_ip_count: int) -> None:
    flags = []
    if same_ip_count > 1:
        flags.append(f"⚠️ ამ IP-დან უკვე {same_ip_count} ანგარიშია")
    text = "\n".join(
        [
            "🆕 <b>ახალი რეგისტრაცია</b>",
            f"👤 <code>{escape(user.email)}</code> (id {user.pk})",
            _ip_line(ip) + (f" · {escape(country)}" if country else ""),
            f"🧾 UA: <code>{escape(ua[:150])}</code>",
            *flags,
            f"🕒 {_when()}",
        ]
    )
    buttons = (
        [
            [
                {"text": "🗑 წაშლა + IP ბანი", "callback_data": f"purge:{user.pk}"},
                {"text": "🔎 IP ინფო", "callback_data": f"ipinfo:{ip}"[:64]},
            ]
        ]
        if ip
        else None
    )
    send(text, buttons=buttons)


def admin_login_alert(user, *, ip: str | None, ua: str, country: str, new_ip: bool) -> None:
    text = "\n".join(
        [
            "🔐 <b>ადმინის შესვლა</b>" + (" — <b>ახალი IP!</b>" if new_ip else ""),
            f"👤 {escape(user.email)}",
            _ip_line(ip) + (f" · {escape(country)}" if country else ""),
            f"🧾 UA: <code>{escape(ua[:150])}</code>",
            f"🕒 {_when()}",
        ]
    )
    send(text, buttons=ip_buttons(ip) if ip and new_ip else None, silent=not new_ip)
