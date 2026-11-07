from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.db.models import Count
from django.utils import timezone

from apps.security import blocklist, cloudflare, notify
from apps.security.models import SecurityEvent

logger = logging.getLogger("mytasker.security")


@shared_task(bind=True, max_retries=5, default_retry_delay=20, ignore_result=True)
def send_alert(self, text: str, markup: dict | None = None, silent: bool = False) -> None:
    from apps.telegram.client import TelegramError

    try:
        notify.deliver(text, markup, silent)
    except TelegramError as exc:
        if exc.permanent:
            logger.warning("security alert dropped", extra={"reason": str(exc)})
            return
        raise self.retry(exc=exc, countdown=exc.retry_after or 20) from exc


@shared_task(ignore_result=True)
def maintain_blocklist() -> None:
    """Every minute: lift expired bans, persist hit counters, refresh the nginx file."""
    blocklist.expire()
    blocklist.flush_hits()
    blocklist.export_file()


@shared_task(ignore_result=True)
def sync_cloudflare() -> None:
    result = cloudflare.sync()
    if result.get("created") or result.get("removed"):
        logger.info("cloudflare blocklist synced", extra=result)


@shared_task(ignore_result=True)
def purge_old_events(days: int = 120) -> None:
    SecurityEvent.objects.filter(created_at__lt=timezone.now() - timedelta(days=days)).delete()


def digest_text(hours: int = 24) -> str:
    from apps.security.guard import KIND_TITLES
    from apps.security.models import SignupRecord

    since = timezone.now() - timedelta(hours=hours)
    events = SecurityEvent.objects.filter(created_at__gte=since)
    by_kind = dict(events.values_list("kind").annotate(n=Count("id")).values_list("kind", "n"))
    top = (
        events.exclude(ip=None)
        .exclude(kind__in=[SecurityEvent.Kind.SIGNUP, SecurityEvent.Kind.ADMIN_LOGIN])
        .values("ip")
        .annotate(n=Count("id"))
        .order_by("-n")[:5]
    )
    lines = [f"📊 <b>უსაფრთხოების შეჯამება · ბოლო {hours} სთ</b>"]
    if not by_kind:
        lines.append("✅ საეჭვო არაფერი მომხდარა.")
    for kind, count in sorted(by_kind.items(), key=lambda kv: -kv[1]):
        lines.append(f"• {KIND_TITLES.get(kind, kind)}: <b>{count}</b>")
    lines.append(f"🆕 რეგისტრაციები: <b>{SignupRecord.objects.filter(created_at__gte=since).count()}</b>")
    lines.append(f"🚫 აქტიური ბლოკები: <b>{blocklist.active().count()}</b>")
    if top:
        lines.append("\n🎯 ყველაზე აქტიური IP-ები:")
        lines.extend(f"  <code>{row['ip']}</code> — {row['n']}" for row in top)
    return "\n".join(lines)


@shared_task(ignore_result=True)
def daily_digest() -> None:
    notify.send(digest_text(24), silent=True)
