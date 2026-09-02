from rest_framework.routers import DefaultRouter

from apps.prompts.views import PromptViewSet

router = DefaultRouter()
router.register("prompts", PromptViewSet, basename="prompt")

urlpatterns = router.urls
