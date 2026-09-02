from django.urls import path

from apps.notifications import views

urlpatterns = [
    path("notifications/", views.notifications, name="notifications"),
    path("notifications/unread/", views.unread, name="notifications-unread"),
    path("notifications/read/", views.mark_read, name="notifications-read"),
    path("notifications/clear/", views.clear, name="notifications-clear"),
    path("notifications/preferences/", views.preferences, name="notification-preferences"),
]
