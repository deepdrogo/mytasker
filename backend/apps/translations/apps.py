from django.apps import AppConfig


class TranslationsConfig(AppConfig):
    name = "apps.translations"
    label = "translations"

    def ready(self) -> None:  # noqa: D401
        from apps.translations.handlers import schedule_translation
        from common.events import subscribe

        subscribe(schedule_translation)
