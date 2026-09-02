from django.apps import AppConfig


class AnalyticsConfig(AppConfig):
    name = "apps.analytics"
    label = "analytics"

    def ready(self) -> None:  # noqa: D401
        pass
