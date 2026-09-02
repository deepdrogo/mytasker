from django.urls import path

from apps.donations import views

urlpatterns = [path("donations/", views.addresses, name="donations")]
