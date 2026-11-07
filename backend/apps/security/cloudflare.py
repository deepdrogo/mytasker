"""
Optional: mirror long bans to Cloudflare IP Access Rules so they are refused at the edge, worldwide.

Enabled only when CLOUDFLARE_API_TOKEN (scope: Zone > Firewall Services > Edit, this zone only) and
CLOUDFLARE_ZONE_ID are set. Only rules this module created (remembered in BlockedIP.cf_rule_id) are ever removed.
"""

from __future__ import annotations

import ipaddress
import logging
from datetime import timedelta

import httpx
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from apps.security.models import BlockedIP

logger = logging.getLogger("mytasker.security.cloudflare")

API = "https://api.cloudflare.com/client/v4"
NOTE_PREFIX = "mytasker-shield:"
# Short bans expire before an edge rule would be worth it.
EDGE_MIN_REMAINING = timedelta(hours=12)


def enabled() -> bool:
    return bool(getattr(settings, "CLOUDFLARE_API_TOKEN", "") and getattr(settings, "CLOUDFLARE_ZONE_ID", ""))


def schedule_sync() -> None:
    if not enabled():
        return
    if cache.add("sec:cf:scheduled", 1, 20):
        from apps.security.tasks import sync_cloudflare

        sync_cloudflare.apply_async(countdown=10)


def _configuration(network: str) -> dict | None:
    net = ipaddress.ip_network(network, strict=False)
    if net.num_addresses == 1:
        return {"target": "ip", "value": str(net.network_address)}
    allowed = {4: (16, 24), 6: (32, 48, 64)}[net.version]
    if net.prefixlen in allowed:
        return {"target": "ip_range", "value": str(net)}
    return None


def sync() -> dict:
    if not enabled():
        return {"enabled": False}
    zone = settings.CLOUDFLARE_ZONE_ID
    headers = {"Authorization": f"Bearer {settings.CLOUDFLARE_API_TOKEN}"}
    now = timezone.now()
    created = removed = 0
    with httpx.Client(base_url=API, headers=headers, timeout=15.0) as client:
        for row in BlockedIP.objects.exclude(cf_rule_id=""):
            if row.is_effective:
                continue
            response = client.delete(f"/zones/{zone}/firewall/access_rules/rules/{row.cf_rule_id}")
            if response.status_code in (200, 404):
                BlockedIP.objects.filter(pk=row.pk).update(cf_rule_id="")
                removed += 1
        for row in BlockedIP.objects.filter(is_active=True, cf_rule_id=""):
            if row.expires_at is not None and row.expires_at - now < EDGE_MIN_REMAINING:
                continue
            configuration = _configuration(row.network)
            if configuration is None:
                continue
            response = client.post(
                f"/zones/{zone}/firewall/access_rules/rules",
                json={"mode": "block", "configuration": configuration, "notes": f"{NOTE_PREFIX} {row.reason}"[:500]},
            )
            data = response.json() if response.headers.get("content-type", "").startswith("application/json") else {}
            if response.status_code == 200 and data.get("success"):
                BlockedIP.objects.filter(pk=row.pk).update(cf_rule_id=data["result"]["id"])
                created += 1
            else:
                logger.warning(
                    "cloudflare block failed", extra={"network": row.network, "status": response.status_code}
                )
    return {"enabled": True, "created": created, "removed": removed}
