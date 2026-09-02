from django.apps import AppConfig


class TimeTrackingConfig(AppConfig):
    name = "apps.time_tracking"
    label = "time_tracking"

    def ready(self) -> None:  # noqa: D401
        pass
