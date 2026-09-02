from django.apps import AppConfig


class TelegramConfig(AppConfig):
    name = "apps.telegram"
    label = "telegram"

    def ready(self) -> None:  # noqa: D401
        pass
