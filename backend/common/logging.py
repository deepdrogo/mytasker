# MyTasker — log redaction. Tokens and keys never hit disk.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

import logging
import re

_PATTERNS = [
    re.compile(r"(bot)(\d+):[A-Za-z0-9_-]{20,}", re.I),  # telegram bot tokens in URLs
    re.compile(r"(sk-ant-[A-Za-z0-9_-]{10,})"),  # anthropic keys
    re.compile(r"(password|passwd|secret|token|api_key|authorization)(\W{1,3})([^\s,;&\"']{4,})", re.I),
]


class RedactSecretsFilter(logging.Filter):
    """Best-effort redaction of secrets that might slip into log messages."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:  # pragma: no cover
            return True
        redacted = msg
        redacted = _PATTERNS[0].sub(r"\1\2:***", redacted)
        redacted = _PATTERNS[1].sub("sk-ant-***", redacted)
        redacted = _PATTERNS[2].sub(r"\1\2***", redacted)
        if redacted != msg:
            record.msg = redacted
            record.args = ()
        return True
