"""Host-level events (SSH logins from PAM) -> security log + Telegram. Called as root via runuser."""

from html import escape

from django.core.management.base import BaseCommand

from apps.security import notify
from apps.security.ip import is_trusted, parse_ip
from apps.security.models import SecurityEvent


class Command(BaseCommand):
    help = "Record a host security event and alert the owner."

    def add_arguments(self, parser):
        parser.add_argument("--kind", choices=["ssh_login"], required=True)
        parser.add_argument("--user", default="")
        parser.add_argument("--ip", default="")
        parser.add_argument("--service", default="")
        parser.add_argument("--host", default="")

    def handle(self, *args, kind, user, ip, service, host, **options):
        address = parse_ip(ip)
        known = bool(address) and SecurityEvent.objects.filter(kind=kind, ip=str(address)).exists()
        trusted = is_trusted(str(address)) if address else False
        SecurityEvent.objects.create(
            kind=kind,
            severity=SecurityEvent.Severity.INFO if (known or trusted) else SecurityEvent.Severity.HIGH,
            ip=str(address) if address else None,
            details={"user": user[:64], "service": service[:32], "host": host[:64]},
        )
        title = "🖥 <b>SSH შესვლა სერვერზე</b>" + ("" if known or trusted else " — <b>ახალი IP!</b>")
        notify.send(
            "\n".join(
                [
                    title,
                    f"👤 {escape(user)}@{escape(host)}",
                    f"🌐 IP: <code>{escape(ip or '?')}</code>",
                    "თუ ეს შენ არ ხარ — სასწრაფოდ შეცვალე root პაროლი და შეამოწმე authorized_keys.",
                ]
            ),
            silent=known or trusted,
        )
