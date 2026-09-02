from django.urls import path

from apps.sharing import views

urlpatterns = [
    path("shares/", views.shares, name="shares"),
    path("shares/<int:pk>/", views.share_detail, name="share-detail"),
    path("shares/<int:pk>/revoke/", views.share_revoke, name="share-revoke"),
    # Guest (anonymous) endpoints
    path("share/<str:token>/", views.guest_view, name="share-guest"),
    path("share/<str:token>/unlock/", views.guest_unlock, name="share-unlock"),
    path("share/<str:token>/identify/", views.guest_identify, name="share-identify"),
    path("share/<str:token>/tasks/<int:task_id>/<str:action>/", views.guest_task_action, name="share-task-action"),
]
