from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.projects.views import IdeaViewSet, ProjectViewSet, accept_invitation

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("ideas", IdeaViewSet, basename="idea")

urlpatterns = [
    path("projects/join/", accept_invitation, name="project-join"),
    *router.urls,
]
