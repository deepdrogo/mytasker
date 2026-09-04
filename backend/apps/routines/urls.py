from django.urls import path

from apps.routines import views

urlpatterns = [
    path("routines/<str:kind>/items/", views.routine_items, name="routine-items"),
    path("routines/<str:kind>/reorder/", views.routine_reorder, name="routine-reorder"),
    path("routines/items/<int:pk>/", views.routine_item_detail, name="routine-item-detail"),
    path("routines/items/<int:pk>/complete/", views.routine_item_complete, name="routine-item-complete"),
    path("rules/", views.rules, name="rules"),
    path("rules/reorder/", views.rules_reorder, name="rules-reorder"),
    path("rules/<int:pk>/", views.rule_detail, name="rule-detail"),
    path("rules/<int:pk>/kept/", views.rule_kept, name="rule-kept"),
]
