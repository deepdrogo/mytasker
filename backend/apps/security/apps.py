from django.apps import AppConfig


class SecurityConfig(AppConfig):
    name = "apps.security"
    label = "security"
    verbose_name = "Security"

    def ready(self) -> None:
        from apps.security import signals  # noqa: F401
