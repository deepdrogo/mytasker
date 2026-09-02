from django.urls import path

from apps.collab import views

urlpatterns = [
    path("comments/", views.comments, name="comments"),
    path("comments/<int:pk>/", views.comment_detail, name="comment-detail"),
    path("activity/", views.activity, name="activity"),
]
