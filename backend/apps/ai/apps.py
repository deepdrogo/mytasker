from django.apps import AppConfig


class AiConfig(AppConfig):
    name = "apps.ai"
    label = "ai"

    def ready(self) -> None:  # noqa: D401
        pass
