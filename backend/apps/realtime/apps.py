from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    name = "apps.realtime"
    label = "realtime"

    def ready(self) -> None:  # noqa: D401
        from apps.realtime.handlers import publish_activity
        from common.events import subscribe

        subscribe(publish_activity)
