from django.apps import AppConfig


class CollabConfig(AppConfig):
    name = "apps.collab"
    label = "collab"

    def ready(self) -> None:  # noqa: D401
        pass
