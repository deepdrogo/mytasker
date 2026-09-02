from rest_framework.routers import DefaultRouter

from apps.tasks.views import TaskViewSet

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")

urlpatterns = router.urls
