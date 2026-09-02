from django.apps import AppConfig


class PromptsConfig(AppConfig):
    name = "apps.prompts"
    label = "prompts"

    def ready(self) -> None:  # noqa: D401
        pass
