"""
The real client address of a request.

nginx sits behind Cloudflare and restores the visitor address from CF-Connecting-IP (trusted only from Cloudflare
ranges, and the firewall admits nothing else on 80/443). It then overwrites X-Real-IP with that address and uvicorn
takes the right-most X-Forwarded-For hop, so neither value can be forged by the client. The left-most
X-Forwarded-For entry *can* be forged and must never be used.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from django.conf import settings

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network


def parse_ip(value: str | None) -> IPAddress | None:
    if not value:
        return None
    try:
        address = ipaddress.ip_address(str(value).strip().split("%", 1)[0])
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def client_ip(request) -> str | None:
    """Canonical text form of the visitor address, or None. Accepts Django and DRF requests."""
    request = getattr(request, "_request", request)
    cached = getattr(request, "_mt_client_ip", False)
    if cached is not False:
        return cached
    remote = parse_ip(request.META.get("REMOTE_ADDR"))
    real = parse_ip(request.META.get("HTTP_X_REAL_IP"))
    address = real if real is not None and (remote is None or remote.is_loopback) else remote
    value = str(address) if address is not None else None
    try:
        request._mt_client_ip = value
    except AttributeError:  # pragma: no cover - exotic request objects
        pass
    return value


def ban_network(ip: str) -> str:
    """What a ban covers: the single IPv4 address, or the whole IPv6 /64 (one subscriber's allocation)."""
    address = parse_ip(ip)
    if address is None:
        raise ValueError(f"not an IP address: {ip!r}")
    if isinstance(address, ipaddress.IPv6Address):
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)


def normalize_network(value: str) -> str:
    """User input (`1.2.3.4`, `1.2.3.0/24`, `2001:db8::1`) to the canonical form stored in the blocklist."""
    value = (value or "").strip()
    if "/" in value:
        network = ipaddress.ip_network(value, strict=False)
        if network.prefixlen < (16 if network.version == 4 else 32):
            raise ValueError("network too wide")
        return str(network)
    return ban_network(value)


@lru_cache(maxsize=1)
def _trusted_networks() -> tuple[IPNetwork, ...]:
    networks = []
    for item in getattr(settings, "SECURITY_TRUSTED_IPS", []):
        try:
            networks.append(ipaddress.ip_network(item.strip(), strict=False))
        except ValueError:
            continue
    return tuple(networks)


def is_trusted(ip: str | None) -> bool:
    """Our own servers and the owner's fixed address: never scored, never banned."""
    address = parse_ip(ip)
    if address is None:
        return False
    return any(address in network for network in _trusted_networks())


def country(request) -> str:
    request = getattr(request, "_request", request)
    return (request.META.get("HTTP_CF_IPCOUNTRY") or "")[:4].upper()


def user_agent(request) -> str:
    request = getattr(request, "_request", request)
    return (request.META.get("HTTP_USER_AGENT") or "")[:300]
