from django.urls import path

from apps.analytics import views

urlpatterns = [
    path("today/", views.today, name="today"),
    path("analytics/daily/", views.daily, name="analytics-daily"),
    path("analytics/weekly/", views.weekly, name="analytics-weekly"),
    path("analytics/monthly/", views.monthly, name="analytics-monthly"),
    path("analytics/recompute/", views.recompute, name="analytics-recompute"),
]
