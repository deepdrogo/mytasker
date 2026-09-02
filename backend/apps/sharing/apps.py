from django.apps import AppConfig


class SharingConfig(AppConfig):
    name = "apps.sharing"
    label = "sharing"

    def ready(self) -> None:  # noqa: D401
        pass
