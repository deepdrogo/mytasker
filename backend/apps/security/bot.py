"""
The owner-only security bot (long polling).

Access: the first private message from SECURITY_BOT_OWNER_USERNAME binds that account's numeric Telegram id; from
then on only that id is obeyed - a later username change or a squatter taking the name gets nothing. Everyone else
is ignored silently (and reported to the owner). Groups are left immediately.
"""

from __future__ import annotations

import logging
import time
from datetime import timedelta
from html import escape

from django.conf import settings
from django.db import close_old_connections
from django.db.models import Count
from django.utils import timezone

from apps.security import blocklist, guard, notify
from apps.security.ip import ban_network, normalize_network, parse_ip
from apps.security.models import BlockedIP, SecurityBotState, SecurityEvent, SignupRecord
from apps.telegram.client import TelegramClient, TelegramError

logger = logging.getLogger("mytasker.security.bot")

HELP = """🛡 <b>MyTasker უსაფრთხოების ბოტი</b>

/status — მიმოხილვა
/signups [სთ] — რეგისტრაციები IP-ებით (ნაგულისხმევი 48)
/events [n] — ბოლო საეჭვო მოვლენები
/blocked — დაბლოკილი IP-ები
/block &lt;ip|cidr&gt; [სთ|perm] [მიზეზი]
/unblock &lt;ip|cidr&gt;
/ip &lt;ip&gt; — IP-ის ისტორია
/purge &lt;user_id|email&gt; — ანგარიშის წაშლა + IP ბანი
/digest — 24 სთ შეჯამება"""


def _fmt_time(value) -> str:
    return timezone.localtime(value).strftime("%m-%d %H:%M") if value else "—"


class SecurityBot:
    def __init__(self, token: str | None = None, owner_username: str | None = None):
        self.token = token or settings.SECURITY_BOT_TOKEN
        self.owner_username = (owner_username or settings.SECURITY_BOT_OWNER_USERNAME or "").lstrip("@").lower()
        self.client = TelegramClient(token=self.token, timeout=65.0)

    # ------------------------------------------------------------------------------------------- loop

    def run_forever(self) -> None:
        if not self.token or not self.owner_username:
            raise RuntimeError("SECURITY_BOT_TOKEN and SECURITY_BOT_OWNER_USERNAME must be set")
        self.client.call("deleteWebhook", drop_pending_updates=False)
        self.client.call(
            "setMyCommands",
            commands=[
                {"command": c, "description": d}
                for c, d in (
                    ("status", "მიმოხილვა"),
                    ("signups", "რეგისტრაციები IP-ებით"),
                    ("events", "საეჭვო მოვლენები"),
                    ("blocked", "დაბლოკილი IP-ები"),
                    ("block", "IP-ის დაბლოკვა"),
                    ("unblock", "IP-ის განბლოკვა"),
                    ("ip", "IP-ის ისტორია"),
                    ("purge", "ანგარიშის წაშლა"),
                    ("digest", "24სთ შეჯამება"),
                    ("help", "დახმარება"),
                )
            ],
        )
        logger.info("security bot started")
        backoff = 1
        while True:
            close_old_connections()
            try:
                self.poll_once()
                backoff = 1
            except TelegramError as exc:
                logger.warning("telegram poll failed", extra={"reason": str(exc)})
                time.sleep(exc.retry_after or backoff)
                backoff = min(backoff * 2, 60)
            except Exception:  # noqa: BLE001 - the bot must survive anything
                logger.exception("security bot loop error")
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)

    def poll_once(self, timeout: int = 50) -> int:
        state = SecurityBotState.load()
        updates = (
            self.client.call(
                "getUpdates",
                offset=state.last_update_id + 1,
                timeout=timeout,
                allowed_updates=["message", "callback_query", "my_chat_member"],
            )
            or []
        )
        for update in updates:
            try:
                self.handle(update)
            except Exception:  # noqa: BLE001
                logger.exception("security bot update failed", extra={"update_id": update.get("update_id")})
            SecurityBotState.objects.filter(pk=1).update(last_update_id=update["update_id"])
        return len(updates)

    # ------------------------------------------------------------------------------------------ access

    def _authorized(self, sender: dict, chat: dict) -> bool:
        if chat.get("type") != "private" or sender.get("is_bot"):
            return False
        state = SecurityBotState.load()
        if state.owner_user_id:
            return sender.get("id") == state.owner_user_id
        if (sender.get("username") or "").lower() != self.owner_username:
            return False
        state.owner_user_id = sender["id"]
        state.owner_chat_id = chat["id"]
        state.owner_username = sender.get("username") or ""
        state.bound_at = timezone.now()
        state.save()
        logger.warning("security bot bound to owner", extra={"telegram_user_id": sender["id"]})
        self.reply(
            chat["id"],
            "✅ <b>დაკავშირებულია.</b> ამიერიდან ამ ბოტს მხოლოდ შენ მართავ "
            f"(Telegram ID <code>{sender['id']}</code>).\n\n{HELP}",
        )
        sent = notify.flush_pending()
        if sent:
            self.reply(chat["id"], f"📬 ზემოთ — {sent} გადადებული შეტყობინება.")
        return True

    def _intruder(self, sender: dict, chat: dict, text: str) -> None:
        if chat.get("type") in ("group", "supergroup", "channel"):
            try:
                self.client.call("leaveChat", chat_id=chat["id"])
            except TelegramError:
                pass
        SecurityEvent.objects.create(
            kind=SecurityEvent.Kind.BOT_INTRUDER,
            severity=SecurityEvent.Severity.MEDIUM,
            details={
                "telegram_user_id": sender.get("id"),
                "username": sender.get("username", ""),
                "chat_type": chat.get("type"),
                "text": (text or "")[:100],
            },
        )
        notify.send(
            "👀 <b>უცხომ მისწერა უსაფრთხოების ბოტს</b>\n"
            f"ID <code>{sender.get('id')}</code> @{escape(sender.get('username') or '—')} "
            f"({escape(sender.get('first_name') or '')})\n"
            f"ჩატი: {escape(chat.get('type') or '?')} · ტექსტი: <code>{escape((text or '')[:80])}</code>\n"
            "პასუხი არ გაეცა.",
            dedupe=f"intruder:{sender.get('id')}",
            ttl=3600,
        )

    # ---------------------------------------------------------------------------------------- dispatch

    def handle(self, update: dict) -> None:
        if "my_chat_member" in update:
            member = update["my_chat_member"]
            chat = member.get("chat", {})
            if chat.get("type") != "private":
                self._intruder(member.get("from", {}), chat, "added bot to a chat")
            return
        if "callback_query" in update:
            query = update["callback_query"]
            message = query.get("message") or {}
            chat = message.get("chat", {})
            if not self._authorized(query.get("from", {}), chat):
                self._intruder(query.get("from", {}), chat, f"button {query.get('data', '')}")
                self.client.call("answerCallbackQuery", callback_query_id=query["id"])
                return
            self.on_button(query, chat["id"])
            return
        message = update.get("message")
        if not message:
            return
        sender, chat, text = message.get("from", {}), message.get("chat", {}), message.get("text") or ""
        if not self._authorized(sender, chat):
            self._intruder(sender, chat, text)
            return
        self.on_command(chat["id"], text.strip())

    def reply(self, chat_id: int, text: str, buttons: list | None = None) -> None:
        markup = {"inline_keyboard": buttons} if buttons else None
        for start in range(0, len(text), 4000):
            self.client.send_message(chat_id, text[start : start + 4000], reply_markup=markup if start == 0 else None)

    def on_command(self, chat_id: int, text: str) -> None:
        parts = text.split()
        if not parts:
            return
        command = parts[0].split("@", 1)[0].lower()
        args = parts[1:]
        handlers = {
            "/start": lambda: self.reply(chat_id, HELP),
            "/help": lambda: self.reply(chat_id, HELP),
            "/status": lambda: self.cmd_status(chat_id),
            "/signups": lambda: self.cmd_signups(chat_id, args),
            "/events": lambda: self.cmd_events(chat_id, args),
            "/blocked": lambda: self.cmd_blocked(chat_id),
            "/block": lambda: self.cmd_block(chat_id, args),
            "/unblock": lambda: self.cmd_unblock(chat_id, args),
            "/ip": lambda: self.cmd_ip(chat_id, args),
            "/purge": lambda: self.cmd_purge(chat_id, args),
            "/digest": lambda: self.cmd_digest(chat_id),
        }
        handler = handlers.get(command)
        if handler is None:
            self.reply(chat_id, "უცნობი ბრძანება. /help")
            return
        handler()

    # ---------------------------------------------------------------------------------------- commands

    def cmd_status(self, chat_id: int) -> None:
        from apps.accounts.models import User

        day = timezone.now() - timedelta(hours=24)
        events = SecurityEvent.objects.filter(created_at__gte=day)
        bans = events.filter(kind__in=[SecurityEvent.Kind.AUTO_BAN, SecurityEvent.Kind.MANUAL_BAN]).count()
        text = "\n".join(
            [
                "🛡 <b>სტატუსი</b>",
                f"👥 მომხმარებლები: <b>{User.objects.count()}</b> · რეგისტრაციები 48სთ: "
                f"<b>{SignupRecord.objects.filter(created_at__gte=timezone.now() - timedelta(hours=48)).count()}</b>",
                f"🚫 აქტიური ბლოკები: <b>{blocklist.active().count()}</b> · ახალი ბანი 24სთ: <b>{bans}</b>",
                f"⚠️ საეჭვო მოვლენები 24სთ: <b>{events.exclude(kind=SecurityEvent.Kind.SIGNUP).count()}</b>",
                f"🔁 სკანერის ხაფანგი 24სთ: <b>{events.filter(kind=SecurityEvent.Kind.TRAP).count()}</b>",
                f"🔑 წარუმატებელი შესვლა 24სთ: <b>{events.filter(kind=SecurityEvent.Kind.LOGIN_FAILED).count()}</b>",
                "\nდეტალები: /digest · /events · /blocked",
            ]
        )
        self.reply(chat_id, text)

    def cmd_signups(self, chat_id: int, args: list[str]) -> None:
        from apps.accounts.models import User

        hours = int(args[0]) if args and args[0].isdigit() else 48
        since = timezone.now() - timedelta(hours=min(hours, 24 * 90))
        users = User.objects.filter(created_at__gte=since, assistant_for__isnull=True).order_by("-created_at")[:25]
        if not users:
            self.reply(chat_id, f"✅ ბოლო {hours} სთ-ში რეგისტრაცია არ ყოფილა.")
            return
        records = {r.user_id: r for r in SignupRecord.objects.filter(user__in=users)}
        for user in users:
            record = records.get(user.pk)
            ip = record.ip if record else None
            lines = [
                f"👤 <code>{escape(user.email)}</code> · id {user.pk}" + (" · ⭐ staff" if user.is_staff else ""),
                f"🕒 {_fmt_time(user.created_at)} · ბოლოს: {_fmt_time(user.last_seen_at)}",
                f"🌐 <code>{escape(ip or 'IP არ ჩაწერილა (ძველი)')}</code>"
                + (f" · {record.country}" if record and record.country else ""),
            ]
            if record and record.user_agent:
                lines.append(f"🧾 <code>{escape(record.user_agent[:120])}</code>")
            buttons = None if user.is_staff else [[{"text": "🗑 წაშლა + ბანი", "callback_data": f"purge:{user.pk}"}]]
            self.reply(chat_id, "\n".join(lines), buttons)

    def cmd_events(self, chat_id: int, args: list[str]) -> None:
        count = min(int(args[0]) if args and args[0].isdigit() else 15, 40)
        rows = SecurityEvent.objects.exclude(kind=SecurityEvent.Kind.SIGNUP).order_by("-id")[:count]
        if not rows:
            self.reply(chat_id, "✅ მოვლენები არ არის.")
            return
        lines = [f"📜 <b>ბოლო {count} მოვლენა</b>"]
        for event in rows:
            icon = notify.SEVERITY_ICON.get(event.severity, "•")
            title = guard.KIND_TITLES.get(event.kind, event.kind)
            where = f" <code>{escape(event.path[:50])}</code>" if event.path else ""
            lines.append(
                f"{icon} {_fmt_time(event.created_at)} {escape(title)} · <code>{event.ip or '—'}</code>{where}"
            )
        self.reply(chat_id, "\n".join(lines))

    def cmd_blocked(self, chat_id: int) -> None:
        rows = blocklist.active().order_by("-updated_at")[:40]
        if not rows:
            self.reply(chat_id, "✅ დაბლოკილი IP არ არის.")
            return
        lines = [f"🚫 <b>აქტიური ბლოკები ({blocklist.active().count()})</b>"]
        for row in rows:
            until = "♾" if row.expires_at is None else _fmt_time(row.expires_at)
            lines.append(f"<code>{row.network}</code> · {until} · {escape(row.reason[:60])}")
        lines.append("\nგანბლოკვა: /unblock &lt;ip&gt;")
        self.reply(chat_id, "\n".join(lines))

    def cmd_block(self, chat_id: int, args: list[str]) -> None:
        if not args:
            self.reply(chat_id, "გამოყენება: /block &lt;ip|cidr&gt; [სთ|perm] [მიზეზი]")
            return
        target = args[0]
        permanent, hours, rest = False, 24 * 7, args[1:]
        if rest and rest[0].lower() in ("perm", "forever", "∞"):
            permanent, rest = True, rest[1:]
        elif rest and rest[0].isdigit():
            hours, rest = int(rest[0]), rest[1:]
        reason = " ".join(rest) or "ხელით, ბოტიდან"
        try:
            normalize_network(target)
        except ValueError:
            self.reply(chat_id, "❌ არასწორი IP / CIDR.")
            return
        row = guard.ban(
            target,
            reason=reason,
            source=BlockedIP.Source.BOT,
            minimum=timedelta(hours=hours),
            permanent=permanent,
            announce=False,
        )
        if row is None:
            self.reply(chat_id, "⛔️ ეს მისამართი სანდოა (სერვერი/შენი IP) — არ დაიბლოკა.")
            return
        until = "სამუდამოდ" if row.expires_at is None else _fmt_time(row.expires_at)
        self.reply(chat_id, f"🚫 <code>{row.network}</code> დაიბლოკა ({until}).")

    def cmd_unblock(self, chat_id: int, args: list[str]) -> None:
        if not args:
            self.reply(chat_id, "გამოყენება: /unblock &lt;ip|cidr&gt;")
            return
        self._unblock(chat_id, args[0])

    def _unblock(self, chat_id: int, target: str) -> None:
        try:
            count = blocklist.unblock(target)
        except ValueError:
            self.reply(chat_id, "❌ არასწორი IP / CIDR.")
            return
        if count:
            probe = parse_ip(target.split("/", 1)[0])
            SecurityEvent.objects.create(
                kind=SecurityEvent.Kind.UNBAN,
                severity=SecurityEvent.Severity.INFO,
                ip=str(probe) if probe else None,
                details={"network": target, "actor": "bot"},
            )
            if probe:
                guard.reset_score(str(probe))
        self.reply(
            chat_id, f"✅ <code>{escape(target)}</code> განიბლოკა." if count else "ეს მისამართი არ იყო დაბლოკილი."
        )

    def cmd_ip(self, chat_id: int, args: list[str]) -> None:
        if not args or parse_ip(args[0]) is None:
            self.reply(chat_id, "გამოყენება: /ip &lt;ip&gt;")
            return
        self._ip_info(chat_id, args[0])

    def _ip_info(self, chat_id: int, ip: str) -> None:
        net = ban_network(ip)
        blocked = blocklist.find(ip)
        events = SecurityEvent.objects.filter(ip=ip)
        kinds = events.values_list("kind").annotate(n=Count("id")).values_list("kind", "n")
        signups = SignupRecord.objects.filter(ip=ip).select_related("user")
        lines = [
            f"🔎 <b>{escape(ip)}</b>" + (f" (ბანი მოიცავს {net})" if net != ip else ""),
            f"სტატუსი: {'🚫 დაბლოკილი' if blocked else '🟢 თავისუფალი'} · ქულა: {guard.score(ip)}/"
            f"{getattr(settings, 'SECURITY_BAN_THRESHOLD', 100)}",
            f"პირველად: {_fmt_time(events.order_by('id').values_list('created_at', flat=True).first())} · "
            f"ბოლოს: {_fmt_time(events.order_by('-id').values_list('created_at', flat=True).first())}",
        ]
        for kind, n in sorted(kinds, key=lambda kv: -kv[1]):
            lines.append(f"• {guard.KIND_TITLES.get(kind, kind)}: {n}")
        for record in signups[:10]:
            email = record.user.email if record.user else "?"
            lines.append(f"👤 რეგისტრაცია: <code>{escape(email)}</code> (id {record.user_id})")
        for event in events.order_by("-id")[:8]:
            lines.append(f"  {_fmt_time(event.created_at)} {event.method} <code>{escape(event.path[:60])}</code>")
        buttons = (
            [[{"text": "✅ განბლოკვა", "callback_data": f"unban:{blocked}"[:64]}]]
            if blocked
            else [
                [
                    {"text": "🔒 დაბლოკვა (7 დღე)", "callback_data": f"ban:{ip}"[:64]},
                    {"text": "♾ სამუდამოდ", "callback_data": f"perm:{ip}"[:64]},
                ]
            ]
        )
        self.reply(chat_id, "\n".join(lines), buttons)

    def cmd_purge(self, chat_id: int, args: list[str]) -> None:
        from apps.accounts.models import User

        if not args:
            self.reply(chat_id, "გამოყენება: /purge &lt;user_id|email&gt;")
            return
        target = args[0]
        user = (
            User.objects.filter(pk=int(target)).first()
            if target.isdigit()
            else User.objects.filter(email__iexact=target).first()
        )
        if user is None:
            self.reply(chat_id, "❌ მომხმარებელი ვერ მოიძებნა.")
            return
        self._confirm_purge(chat_id, user)

    def _confirm_purge(self, chat_id: int, user) -> None:
        if user.is_staff:
            self.reply(chat_id, "⛔️ ადმინის ანგარიშის წაშლა ბოტიდან აკრძალულია.")
            return
        from apps.security.purge import known_ips

        ips = ", ".join(known_ips(user)) or "—"
        self.reply(
            chat_id,
            f"⚠️ <b>წავშალო სამუდამოდ?</b>\n👤 <code>{escape(user.email)}</code> (id {user.pk})\n"
            f"ყველა მონაცემი წაიშლება, სესიები გაითიშება, IP-ები დაიბლოკება 30+ დღით:\n<code>{escape(ips)}</code>",
            [
                [
                    {"text": "🗑 დიახ, წაშალე", "callback_data": f"purgeok:{user.pk}"},
                    {"text": "გაუქმება", "callback_data": "cancel"},
                ]
            ],
        )

    def cmd_digest(self, chat_id: int) -> None:
        from apps.security.tasks import digest_text

        self.reply(chat_id, digest_text(24))

    # ----------------------------------------------------------------------------------------- buttons

    def on_button(self, query: dict, chat_id: int) -> None:
        data = query.get("data") or ""
        action, _, value = data.partition(":")
        answer = ""
        if action == "ban" and parse_ip(value):
            row = guard.ban(
                value,
                reason="ხელით, ბოტის ღილაკით",
                source=BlockedIP.Source.BOT,
                minimum=timedelta(days=7),
                announce=False,
            )
            answer = f"🚫 {row.network} დაიბლოკა" if row else "სანდო მისამართია"
        elif action == "perm":
            try:
                row = guard.ban(
                    value,
                    reason="სამუდამო ბანი, ბოტიდან",
                    source=BlockedIP.Source.BOT,
                    permanent=True,
                    announce=False,
                )
                answer = f"♾ {row.network} სამუდამოდ" if row else "სანდო მისამართია"
            except ValueError:
                answer = "არასწორი მისამართი"
        elif action == "unban":
            self._unblock(chat_id, value)
        elif action == "ipinfo" and parse_ip(value):
            self._ip_info(chat_id, value)
        elif action == "purge" and value.isdigit():
            from apps.accounts.models import User

            user = User.objects.filter(pk=int(value)).first()
            if user is None:
                answer = "უკვე წაშლილია"
            else:
                self._confirm_purge(chat_id, user)
        elif action == "purgeok" and value.isdigit():
            from apps.security.purge import PurgeRefused, purge_user

            try:
                result = purge_user(int(value), actor="security-bot")
                self.reply(
                    chat_id,
                    f"🗑 <b>წაიშალა</b> {escape(result['email'])}\n"
                    f"ჩანაწერები: {result['rows']} · სესიები: {result['sessions']}\n"
                    f"დაბლოკილი: <code>{escape(', '.join(result['banned']) or '—')}</code>",
                )
            except PurgeRefused as exc:
                answer = str(exc)
        elif action == "cancel":
            answer = "გაუქმდა"
        self.client.call("answerCallbackQuery", callback_query_id=query["id"], text=answer[:190] or None)
