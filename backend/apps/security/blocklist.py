"""
The IP blocklist.

Checked on every request, so lookups are served from a per-process copy that is refreshed when the shared version
counter in Redis moves (at most every few seconds). Every change is also written to a plain text file that a root
service turns into nginx `deny` rules, so a banned address is refused before it reaches Python at all.
"""

from __future__ import annotations

import ipaddress
import logging
import os
import tempfile
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from apps.security.ip import is_trusted, normalize_network, parse_ip
from apps.security.models import BlockedIP

logger = logging.getLogger("mytasker.security")

VERSION_KEY = "sec:blocklist:version"
HITS_KEY = "sec:blocklist:hits:{}"
# Each repeat ban lasts longer; None = permanent.
ESCALATION: tuple[timedelta | None, ...] = (timedelta(hours=1), timedelta(hours=24), timedelta(days=7), None)

_local: dict = {"checked": 0.0, "loaded": 0.0, "version": None, "entries": ()}
_CHECK_EVERY = 3.0
_RELOAD_EVERY = 60.0


def _version() -> int:
    try:
        return int(cache.get(VERSION_KEY) or 0)
    except Exception:  # noqa: BLE001 - Redis down must not take the site down
        return -1


def _bump() -> None:
    try:
        if cache.add(VERSION_KEY, 1, None) is False:
            cache.incr(VERSION_KEY)
    except Exception:  # noqa: BLE001
        logger.warning("blocklist version bump failed")
    _local["checked"] = 0.0
    _local["version"] = None


def _load() -> tuple:
    now = timezone.now()
    rows = BlockedIP.objects.filter(is_active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    entries = []
    for network, expires_at in rows.values_list("network", "expires_at"):
        try:
            entries.append(
                (ipaddress.ip_network(network, strict=False), expires_at.timestamp() if expires_at else None, network)
            )
        except ValueError:
            continue
    return tuple(entries)


def _entries() -> tuple:
    now = time.monotonic()
    if now - _local["checked"] >= _CHECK_EVERY:
        version = _version()
        if version != _local["version"] or now - _local["loaded"] >= _RELOAD_EVERY:
            try:
                _local["entries"] = _load()
                _local["loaded"] = now
                _local["version"] = version
            except Exception:  # noqa: BLE001 - keep serving the last good copy
                logger.exception("blocklist reload failed")
        _local["checked"] = now
    return _local["entries"]


def find(ip: str | None) -> str | None:
    """The blocklist entry covering `ip`, or None."""
    address = parse_ip(ip)
    if address is None:
        return None
    wall = time.time()
    for network, expires, label in _entries():
        if address.version == network.version and address in network and (expires is None or expires > wall):
            return label
    return None


def note_hit(network: str) -> None:
    try:
        key = HITS_KEY.format(network)
        if cache.add(key, 1, 7 * 24 * 3600) is False:
            cache.incr(key)
    except Exception:  # noqa: BLE001
        pass


def flush_hits() -> None:
    """Move the per-entry hit counters from Redis into the table (called from the periodic task)."""
    for row in BlockedIP.objects.filter(is_active=True).only("pk", "network"):
        key = HITS_KEY.format(row.network)
        try:
            count = int(cache.get(key) or 0)
        except Exception:  # noqa: BLE001
            return
        if count:
            cache.delete(key)
            BlockedIP.objects.filter(pk=row.pk).update(hits=F("hits") + count, last_hit_at=timezone.now())


def _duration_for(offenses: int, minimum: timedelta | None) -> timedelta | None:
    step = ESCALATION[min(offenses, len(ESCALATION)) - 1]
    if step is None or minimum is None:
        return None
    return max(step, minimum)


def block(
    value: str,
    *,
    reason: str,
    source: str = BlockedIP.Source.AUTO,
    minimum: timedelta | None = timedelta(hours=1),
    permanent: bool = False,
) -> BlockedIP | None:
    """
    Ban an address or network. A network that was banned before gets the next, longer step of ESCALATION
    (never shorter than `minimum`). Trusted addresses are never banned. Returns the row, or None when refused.
    """
    network = normalize_network(value)
    probe = network.split("/", 1)[0]
    if is_trusted(probe):
        logger.warning("refused to ban trusted address", extra={"network": network})
        return None
    now = timezone.now()
    with transaction.atomic():
        row = BlockedIP.objects.select_for_update().filter(network=network).first()
        if row is None:
            offenses = 1
            row = BlockedIP(network=network)
        else:
            offenses = row.offenses + (0 if row.is_effective else 1)
        duration = None if permanent else _duration_for(offenses, minimum)
        new_expiry = None if duration is None else now + duration
        if row.pk and row.is_effective and (row.expires_at is None or (new_expiry and row.expires_at > new_expiry)):
            new_expiry = row.expires_at  # never shorten an existing ban
        row.reason = reason[:200]
        row.source = source
        row.is_active = True
        row.expires_at = new_expiry
        row.offenses = offenses
        row.save()
    transaction.on_commit(_after_change)
    return row


def unblock(value: str) -> int:
    network = normalize_network(value) if "/" not in value else str(ipaddress.ip_network(value, strict=False))
    updated = BlockedIP.objects.filter(network=network, is_active=True).update(
        is_active=False, updated_at=timezone.now()
    )
    if updated:
        transaction.on_commit(_after_change)
    return updated


def expire() -> int:
    """Deactivate bans whose time is up. Offense counts stay so the next ban is longer."""
    updated = BlockedIP.objects.filter(
        is_active=True, expires_at__isnull=False, expires_at__lte=timezone.now()
    ).update(is_active=False, updated_at=timezone.now())
    if updated:
        _after_change()
    return updated


def active():
    now = timezone.now()
    return BlockedIP.objects.filter(is_active=True).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))


def _after_change() -> None:
    _bump()
    export_file()
    try:
        from apps.security import cloudflare

        cloudflare.schedule_sync()
    except Exception:  # noqa: BLE001
        logger.exception("cloudflare sync scheduling failed")


def export_file() -> None:
    """Plain list of banned networks for the root nginx sync service. Written atomically."""
    path = Path(getattr(settings, "SECURITY_BLOCKLIST_FILE", "") or "")
    if not str(path):
        return
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = sorted(set(active().values_list("network", flat=True)))
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".blocklist-", suffix=".tmp")
        with os.fdopen(fd, "w") as handle:
            handle.write("".join(f"{line}\n" for line in lines))
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except OSError:
        logger.exception("blocklist export failed", extra={"path": str(path)})
