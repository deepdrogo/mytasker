# MyTasker — URL map. Everything under /api/v1/.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

from django.contrib import admin
from django.urls import include, path

from common.views import health

api_v1 = [
    path("health/", health, name="health"),
    path("auth/", include("apps.accounts.urls")),
    path("", include("apps.tasks.urls")),
    path("", include("apps.projects.urls")),
    path("", include("apps.prompts.urls")),
    path("", include("apps.routines.urls")),
    path("", include("apps.time_tracking.urls")),
    path("", include("apps.collab.urls")),
    path("", include("apps.sharing.urls")),
    path("", include("apps.notifications.urls")),
    path("", include("apps.telegram.urls")),
    path("", include("apps.ai.urls")),
    path("", include("apps.analytics.urls")),
    path("", include("apps.donations.urls")),
    path("", include("apps.translations.urls")),
    path("", include("common.search_urls")),
]

urlpatterns = [
    path("health/", health, name="health-root"),
    path("admin/", admin.site.urls),
    path("api/v1/", include((api_v1, "api"), namespace="v1")),
]
