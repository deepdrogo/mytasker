from django.apps import AppConfig


class TasksConfig(AppConfig):
    name = "apps.tasks"
    label = "tasks"

    def ready(self) -> None:  # noqa: D401
        pass
