from django.apps import AppConfig


class DonationsConfig(AppConfig):
    name = "apps.donations"
    label = "donations"

    def ready(self) -> None:  # noqa: D401
        pass
