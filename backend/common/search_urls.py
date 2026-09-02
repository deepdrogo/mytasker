from django.urls import path

from common.search import global_search

urlpatterns = [path("search/", global_search, name="search")]
