from django.urls import path

from apps.telegram import views

urlpatterns = [
    path("telegram/", views.connection, name="telegram-connection"),
    path("telegram/link/", views.link, name="telegram-link"),
    path("telegram/unlink/", views.unlink, name="telegram-unlink"),
    path("telegram/test/", views.test_message, name="telegram-test"),
    path("telegram/deliveries/", views.deliveries, name="telegram-deliveries"),
    path("telegram/webhook/", views.webhook, name="telegram-webhook"),
]
