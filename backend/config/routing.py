from django.urls import path

from apps.realtime.consumers import AppConsumer

websocket_urlpatterns = [
    path("ws/app/", AppConsumer.as_asgi()),
]
