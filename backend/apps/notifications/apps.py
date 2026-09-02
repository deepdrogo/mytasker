from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    name = "apps.notifications"
    label = "notifications"

    def ready(self) -> None:  # noqa: D401
        from apps.notifications.handlers import schedule_fan_out
        from common.events import subscribe

        subscribe(schedule_fan_out)
