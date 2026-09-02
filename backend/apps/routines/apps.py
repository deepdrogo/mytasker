from django.apps import AppConfig


class RoutinesConfig(AppConfig):
    name = "apps.routines"
    label = "routines"

    def ready(self) -> None:  # noqa: D401
        pass
