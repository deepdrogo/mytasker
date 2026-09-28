from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.projects.views import IdeaViewSet, ProjectViewSet, accept_invitation, daily_checkin_history, daily_checkins

router = DefaultRouter()
router.register("projects", ProjectViewSet, basename="project")
router.register("ideas", IdeaViewSet, basename="idea")

urlpatterns = [
    path("projects/join/", accept_invitation, name="project-join"),
    path("checkins/daily/", daily_checkins, name="daily-checkins"),
    path("checkins/history/", daily_checkin_history, name="daily-checkin-history"),
    *router.urls,
]
