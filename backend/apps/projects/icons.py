"""
Project icons: the favicon of a project's website (or a chosen logo image), fetched by the worker and kept as a
96px PNG.

Outbound requests only reach public addresses (no loopback, private, link-local or reserved ranges; every
redirect is re-checked) on ports 80/443, with tight timeouts and byte caps. Whatever comes back is decoded by
Pillow and re-encoded as PNG, so nothing but pixels is ever stored or served.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import ipaddress
import logging
import os
import re
import socket
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone
from PIL import Image

logger = logging.getLogger("mytasker.projects.icons")

ICON_SUBDIR = "project-icons"
ICON_SIZE = 96
MAX_PAGE_BYTES = 768 * 1024
MAX_ICON_BYTES = 1024 * 1024
MAX_PIXELS = 4096 * 4096
MAX_REDIRECTS = 4
MAX_CANDIDATES = 6
ALLOWED_PORTS = {80, 443}
TIMEOUT = httpx.Timeout(6.0, connect=4.0)
HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MyTaskerIconBot/1.0; +https://mytasker.io)",
    "Accept": "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.5",
}
ICON_RELS = {"icon", "apple-touch-icon", "apple-touch-icon-precomposed"}


class IconError(Exception):
    pass


def normalize_website(raw: str) -> str:
    """`example.com` -> `https://example.com`. Raises ValueError for anything but a plain http(s) address."""
    value = (raw or "").strip()
    if not value:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
        raise ValueError("Enter a website address like example.com.")
    if "." not in parts.hostname and ":" not in parts.hostname:
        raise ValueError("Enter a website address like example.com.")
    if len(value) > 300:
        raise ValueError("The address is too long.")
    return value


def icon_url(file_name: str) -> str | None:
    return f"{settings.MEDIA_URL}{ICON_SUBDIR}/{file_name}" if file_name else None


# ------------------------------------------------------------------------------------- network


def _assert_public(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise IconError("unsupported url")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise IconError("port not allowed")
    try:
        infos = socket.getaddrinfo(parts.hostname, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise IconError("dns failed") from exc
    if not infos:
        raise IconError("dns empty")
    for info in infos:
        address = ipaddress.ip_address(str(info[4][0]).split("%", 1)[0])
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
            address = address.ipv4_mapped
        if not address.is_global or address.is_multicast:
            raise IconError("address is not public")


def _get(client: httpx.Client, url: str, limit: int) -> tuple[str, str, bytes]:
    """GET with manual, re-validated redirects and a hard byte cap. Returns (final url, content type, body)."""
    for _ in range(MAX_REDIRECTS + 1):
        _assert_public(url)
        with client.stream("GET", url) as response:
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise IconError("redirect without location")
                url = urljoin(str(response.url), location)
                continue
            if response.status_code != 200:
                raise IconError(f"status {response.status_code}")
            declared = response.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > limit:
                raise IconError("too large")
            body = bytearray()
            for chunk in response.iter_bytes():
                body += chunk
                if len(body) > limit:
                    raise IconError("too large")
            return str(response.url), response.headers.get("content-type", "").lower(), bytes(body)
    raise IconError("too many redirects")


# ---------------------------------------------------------------------------------------- html


class _IconLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.base: str | None = None
        self.links: list[tuple[int, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): (value or "").strip() for key, value in attrs}
        if tag == "base" and self.base is None and values.get("href"):
            self.base = values["href"]
            return
        if tag != "link":
            return
        rels = set(values.get("rel", "").lower().split())
        href = values.get("href", "")
        if not href or not rels & ICON_RELS or "mask-icon" in rels:
            return
        if "svg" in values.get("type", "") or href.lower().split("?", 1)[0].endswith(".svg"):
            return  # vector icons cannot be rasterised here; the next candidate or the avatar takes over
        sizes = [int(n) for n in re.findall(r"(\d+)\s*[xX]\s*\d+", values.get("sizes", ""))]
        size = max(sizes) if sizes else (180 if rels & {"apple-touch-icon", "apple-touch-icon-precomposed"} else 32)
        self.links.append((size, href))

    def ranked(self) -> list[str]:
        """Big enough for a crisp 64px tile first, smallest of those; then the rest, largest first."""
        good = sorted((link for link in self.links if link[0] >= ICON_SIZE), key=lambda link: link[0])
        small = sorted((link for link in self.links if link[0] < ICON_SIZE), key=lambda link: -link[0])
        return [href for _, href in [*good, *small]]


def _decode_data_uri(uri: str) -> bytes | None:
    match = re.match(r"data:image/[\w.+-]+;base64,(.*)$", uri, re.IGNORECASE | re.DOTALL)
    if not match or len(match.group(1)) > MAX_ICON_BYTES * 4 // 3 + 4:
        return None
    try:
        return base64.b64decode(match.group(1), validate=False)
    except (binascii.Error, ValueError):
        return None


# --------------------------------------------------------------------------------------- image


def rasterize(data: bytes) -> bytes | None:
    """Any bitmap favicon (ico/png/gif/jpeg/webp) to a centred square RGBA PNG. None when it is not usable."""
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_PIXELS:
            return None
        image.load()
    except Exception:  # noqa: BLE001 - anything Pillow refuses is simply not an icon
        return None
    if min(image.size) < 16:
        return None
    image = image.convert("RGBA")
    width, height = image.size
    scale = ICON_SIZE / max(width, height)
    resized = image.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS if scale < 1 else Image.Resampling.BICUBIC,
    )
    canvas = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
    canvas.paste(resized, ((ICON_SIZE - resized.width) // 2, (ICON_SIZE - resized.height) // 2))
    if canvas.getchannel("A").getbbox() is None:
        return None
    out = io.BytesIO()
    canvas.save(out, "PNG", optimize=True)
    return out.getvalue()


def fetch_icon(website: str) -> bytes | None:
    """The best favicon of `website` as PNG bytes, or None."""
    candidates: list[str] = []
    page_url = website
    with httpx.Client(follow_redirects=False, timeout=TIMEOUT, headers=HEADERS, trust_env=False) as client:
        try:
            page_url, content_type, body = _get(client, website, MAX_PAGE_BYTES)
            if "html" in content_type or body[:512].lstrip().lower().startswith((b"<!doctype", b"<html")):
                parser = _IconLinks()
                parser.feed(body.decode("utf-8", errors="replace"))
                parser.close()
                base = urljoin(page_url, parser.base) if parser.base else page_url
                candidates = [href if href.startswith("data:") else urljoin(base, href) for href in parser.ranked()]
        except (IconError, httpx.HTTPError) as exc:
            logger.info("icon page fetch failed", extra={"website": website, "reason": str(exc)})
        for root in (page_url, website):
            parts = urlsplit(root)
            candidates.append(f"{parts.scheme}://{parts.netloc}/favicon.ico")

        seen: set[str] = set()
        for url in candidates:
            if url in seen:
                continue
            seen.add(url)
            if len(seen) > MAX_CANDIDATES:
                break
            if url.startswith("data:"):
                data = _decode_data_uri(url)
            else:
                try:
                    _, _, data = _get(client, url, MAX_ICON_BYTES)
                except (IconError, httpx.HTTPError):
                    continue
            png = rasterize(data) if data else None
            if png:
                return png
    return None


def fetch_image(url: str) -> bytes | None:
    """One specific logo image as PNG bytes, or None."""
    with httpx.Client(follow_redirects=False, timeout=TIMEOUT, headers=HEADERS, trust_env=False) as client:
        try:
            _, _, data = _get(client, url, MAX_ICON_BYTES)
        except (IconError, httpx.HTTPError) as exc:
            logger.info("icon image fetch failed", extra={"url": url, "reason": str(exc)})
            return None
    return rasterize(data)


# ------------------------------------------------------------------------------------- catalog


class _CatalogLinks(HTMLParser):
    """`<a class="fab-dot" href=site><img src=logo><span class="fab-tip">Name</span></a>` cards (drogoz.network)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.entries: list[dict] = []
        self._card: dict | None = None
        self._in_name = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): (value or "").strip() for key, value in attrs}
        classes = values.get("class", "").split()
        if tag == "a" and "fab-dot" in classes and values.get("href"):
            self._card = {"site": values["href"], "logo": "", "name": ""}
        elif self._card is not None and tag == "img" and not self._card["logo"]:
            self._card["logo"] = values.get("src", "")
        elif self._card is not None and tag == "span" and "fab-tip" in classes:
            self._in_name = True

    def handle_data(self, data: str) -> None:
        if self._card is not None and self._in_name:
            self._card["name"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "span":
            self._in_name = False
        elif tag == "a" and self._card is not None:
            card, self._card = self._card, None
            if card["name"].strip() and card["logo"]:
                self.entries.append({**card, "name": card["name"].strip()})


def catalog_entries(url: str) -> list[dict]:
    """Projects listed on a catalog page: name, site and absolute logo URL, each name once."""
    with httpx.Client(follow_redirects=False, timeout=TIMEOUT, headers=HEADERS, trust_env=False) as client:
        page_url, _, body = _get(client, url, MAX_PAGE_BYTES * 2)
    parser = _CatalogLinks()
    parser.feed(body.decode("utf-8", errors="replace"))
    parser.close()
    seen: set[str] = set()
    entries = []
    for entry in parser.entries:
        if entry["name"] in seen:
            continue
        seen.add(entry["name"])
        entries.append({**entry, "logo": urljoin(page_url, entry["logo"]), "site": urljoin(page_url, entry["site"])})
    return entries


def name_key(name: str) -> str:
    return re.sub(r"[^0-9a-z]", "", name.lower())


def same_project(a: str, b: str) -> bool:
    """'Masting AI' ~ 'Masting', 'Mamont' ~ 'Mamont Financial Technology', 'Drogo Pay' ~ 'DrogoPay'."""
    x, y = name_key(a), name_key(b)
    if not x or not y:
        return False
    if x == y:
        return True
    short, long = sorted((x, y), key=len)
    return len(short) >= 4 and long.startswith(short)


# ------------------------------------------------------------------------------------- storage


def icon_dir() -> Path:
    return Path(settings.MEDIA_ROOT) / ICON_SUBDIR


def store(png: bytes) -> str:
    """Write once under a content-hash name; the same picture is never stored twice."""
    name = f"{hashlib.sha256(png).hexdigest()[:40]}.png"
    folder = icon_dir()
    folder.mkdir(parents=True, exist_ok=True)
    os.chmod(folder, 0o755)
    target = folder / name
    if not target.exists():
        fd, tmp = tempfile.mkstemp(dir=folder, suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(png)
            os.chmod(tmp, 0o644)
            os.replace(tmp, target)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    return name


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().removeprefix("www.")


def _site_key(url: str) -> str:
    """Host plus path, so github.com/someone/repo is not the same site as github.com."""
    return _host(url) + urlsplit(url).path.rstrip("/").lower()


def cached_catalog() -> list[dict]:
    """The logo catalog (drogoz.network by default), read at most once an hour."""
    url = settings.PROJECT_LOGO_CATALOG
    if not url:
        return []
    key = f"projects:logo-catalog:{hashlib.sha256(url.encode()).hexdigest()[:16]}"
    entries = cache.get(key)
    if entries is None:
        try:
            entries = catalog_entries(url)
        except (IconError, httpx.HTTPError) as exc:
            logger.info("logo catalog unreachable", extra={"url": url, "reason": str(exc)})
            return []
        cache.set(key, entries, 3600)
    return entries


def find_logo(project, website: str) -> dict:
    """
    One-button logo search for a project. Returns `{"icon", "website", "icon_source", "found_in"}`.

    The catalog's card wins when its link is the same site, or when no own site is given (or the catalog itself
    is typed in); otherwise the given site's favicon, and the catalog by name as a last resort.
    """
    entries = cached_catalog()
    catalog_host = _host(settings.PROJECT_LOGO_CATALOG or "")
    host = _host(website) if website else ""
    by_host = next((entry for entry in entries if host and _site_key(entry["site"]) == _site_key(website)), None)
    by_name = next((entry for entry in entries if same_project(project.name, entry["name"])), None)

    def from_card(card: dict) -> dict | None:
        png = fetch_image(card["logo"])
        if not png:
            return None
        site = website if website and host != catalog_host else normalize_website(card["site"])
        return {"icon": store(png), "website": site, "icon_source": card["logo"], "found_in": "catalog"}

    if by_host:
        found = from_card(by_host)
        if found:
            return found
    if by_name and (not website or host == catalog_host):
        found = from_card(by_name)
        if found:
            return found
    if website:
        png = fetch_icon(website)
        if png:
            return {"icon": store(png), "website": website, "icon_source": "", "found_in": "website"}
    if by_name:
        found = from_card(by_name)
        if found:
            return found
    return {"icon": "", "website": website, "icon_source": "", "found_in": ""}


def refresh_project_icon(project_id: int, *, keep_on_failure: bool = False) -> str:
    """Fetch and save the icon for one project. Returns the stored file name, or '' when there is none."""
    from apps.projects.models import Project

    project = Project.objects.filter(pk=project_id).only("pk", "website", "icon_file", "icon_source").first()
    if project is None:
        return ""
    website = project.website
    icon = ""
    if website or project.icon_source:
        try:
            png = fetch_image(project.icon_source) if project.icon_source else None
            if png is None and website:
                png = fetch_icon(website)
        except Exception:  # noqa: BLE001 - a broken site must never break the worker
            logger.exception("icon fetch crashed", extra={"project_id": project_id})
            png = None
        icon = store(png) if png else ""
        if not icon and keep_on_failure:
            icon = project.icon_file
    # Only if the website was not changed meanwhile; `updated_at` / `version` stay put - this is not an edit.
    Project.objects.filter(pk=project_id, website=website).update(icon_file=icon, icon_checked_at=timezone.now())
    return icon


def request_icon(project_id: int) -> None:
    """Queue a fetch after the surrounding transaction commits."""
    if not settings.PROJECT_ICONS_ENABLED:
        return

    def _send() -> None:
        from apps.projects.tasks import refresh_project_icon_task

        try:
            refresh_project_icon_task.delay(project_id)
        except Exception:  # pragma: no cover - broker down must never break the request
            logger.exception("could not enqueue icon fetch", extra={"project_id": project_id})

    transaction.on_commit(_send)
