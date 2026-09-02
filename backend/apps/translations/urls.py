from django.urls import path

from apps.translations import views

urlpatterns = [
    path("translations/lookup/", views.lookup, name="translations-lookup"),
    path("translations/retry/", views.retry, name="translations-retry"),
]
