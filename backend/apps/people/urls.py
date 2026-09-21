from django.urls import path

from apps.people import views

urlpatterns = [
    path("people/", views.people, name="people"),
    path("people/search/", views.search, name="people-search"),
    path("people/delegators/", views.delegators, name="people-delegators"),
    path("people/<int:pk>/", views.person_detail, name="person-detail"),
]
