"""
Request inspection: hacker tools, scanner paths and attack payloads. Pure functions - no I/O.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import unquote_plus

from apps.security.models import SecurityEvent

Kind = SecurityEvent.Kind

API_PREFIX = "/api/"
AUTH_PREFIX = "/api/v1/auth/"
TRAP_PATH = "/api/v1/_trap/"

# Never inspected: machine-to-machine endpoints with their own authentication.
EXEMPT_PATHS = ("/api/v1/telegram/webhook/", "/api/v1/health/", "/health/")

# Command-line HTTP clients, scripting libraries, scanners and headless browsers. A real browser never sends these.
_TOOL_UA = re.compile(
    r"curl|wget|python-requests|python-urllib|python/|aiohttp|httpx|go-http-client|okhttp|libwww|lwp-|"
    r"java/|apache-httpclient|node-fetch|axios/|undici|got \(|scrapy|httpie|postmanruntime|insomnia|"
    r"sqlmap|nikto|nuclei|zgrab|masscan|nmap|gobuster|dirbuster|dirb/|ffuf|wfuzz|feroxbuster|hydra|"
    r"burp|acunetix|netsparker|wpscan|whatweb|assetnote|censys|shodan|zmap|nessus|openvas|jaeles|"
    r"headlesschrome|phantomjs|selenium|puppeteer|playwright|mechanize|winhttp|powershell",
    re.IGNORECASE,
)
# Bare placeholders scripts send to look like a browser.
_FAKE_UA = {"", "-", "mozilla", "mozilla/5.0", "mozilla/4.0", "user-agent", "test", "agent"}

# Paths only exploit scanners ask for. Matched against API/admin paths that reach Django.
_SCANNER_PATH = re.compile(
    r"(^|/)(\.env|\.git|\.svn|\.hg|\.aws|\.ssh|\.ds_store|\.htaccess|\.htpasswd|\.vscode|\.idea|wp-admin|wp-login|"
    r"wp-content|wp-includes|xmlrpc\.php|phpmyadmin|phpinfo|server-status|server-info|cgi-bin|actuator|"
    r"__debug__|_profiler|telescope|vendor/phpunit|web\.config|config\.php|configuration\.php|"
    r"id_rsa|shell\.php|eval-stdin\.php)",
    re.IGNORECASE,
)
_SCANNER_EXT = re.compile(r"\.(php\d?|asp|aspx|jsp|cgi|pl|sql|bak|old|swp|ini|log|sh)$", re.IGNORECASE)

# Payloads in the URL (path + query string). Deliberately strong signals only: search boxes hit these endpoints too.
_INJECTION = re.compile(
    r"(\bunion\b[\s/*+]+(all[\s/*+]+)?select\b|\bselect\b.{1,80}\bfrom\b.{1,80}\b(information_schema|pg_|mysql\.)|"
    r"\bsleep\s*\(\s*\d|\bbenchmark\s*\(|\bpg_sleep\b|\bwaitfor\s+delay\b|"
    r"'\s*or\s*'?\d+'?\s*=\s*'?\d|\bor\s+1\s*=\s*1\b|"
    r"\.\./|\.\.\\|/etc/passwd|/etc/shadow|/proc/self|c:\\windows|"
    r"<\s*script|javascript:|onerror\s*=|onload\s*=|"
    r"\$\{jndi:|\$\{\s*env|\{\{\s*7\s*\*\s*7|"
    r"(php|file|gopher|dict|expect|data|phar|jar)://|"
    r";\s*(wget|curl|bash|sh|nc|ncat|python|perl)\s|\|\s*(bash|sh)\b|\$\(\s*(wget|curl|id|whoami|cat)\b|`(id|whoami)`|"
    r"%00|\x00)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Verdict:
    kind: str
    points: int
    reject: bool = True
    status: int = 403
    severity: str = SecurityEvent.Severity.MEDIUM
    details: dict = field(default_factory=dict)


def is_tool_user_agent(ua: str) -> bool:
    stripped = (ua or "").strip()
    return stripped.lower() in _FAKE_UA or bool(_TOOL_UA.search(stripped))


def is_scanner_path(path: str) -> bool:
    return bool(_SCANNER_PATH.search(path) or _SCANNER_EXT.search(path))


def find_injection(path: str, query: str) -> str | None:
    for raw in (path, query):
        if not raw:
            continue
        decoded = unquote_plus(unquote_plus(raw))
        match = _INJECTION.search(decoded)
        if match:
            return match.group(0)[:80]
    return None


def inspect(method: str, path: str, query: str, ua: str) -> Verdict | None:
    """The first problem with a request, or None. Only API/admin traffic reaches Django."""
    if path.startswith(EXEMPT_PATHS):
        return None
    if path.startswith(TRAP_PATH):
        return Verdict(Kind.TRAP, 100, status=404, severity=SecurityEvent.Severity.HIGH)
    if is_scanner_path(path):
        return Verdict(Kind.TRAP, 100, status=404, severity=SecurityEvent.Severity.HIGH, details={"path": path[:200]})
    payload = find_injection(path, query)
    if payload:
        return Verdict(Kind.INJECTION, 60, severity=SecurityEvent.Severity.HIGH, details={"match": payload})
    if (path.startswith(API_PREFIX) or path.startswith("/admin")) and is_tool_user_agent(ua):
        sensitive = path.startswith(AUTH_PREFIX) or path.startswith("/admin")
        return Verdict(
            Kind.BAD_UA,
            100 if sensitive else 50,
            severity=SecurityEvent.Severity.HIGH if sensitive else SecurityEvent.Severity.MEDIUM,
            details={"ua": (ua or "")[:120]},
        )
    return None
