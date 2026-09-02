from django.apps import AppConfig


class ProjectsConfig(AppConfig):
    name = "apps.projects"
    label = "projects"

    def ready(self) -> None:  # noqa: D401
        pass
