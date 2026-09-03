from django.urls import path

from apps.ai import views

urlpatterns = [
    path("ai/status/", views.status_view, name="ai-status"),
    path("ai/command/", views.command, name="ai-command"),
    path("ai/actions/", views.history, name="ai-history"),
    path("ai/actions/<int:pk>/confirm/", views.confirm, name="ai-confirm"),
    path("ai/actions/<int:pk>/reject/", views.reject, name="ai-reject"),
    path("ai/tasks/polish/", views.polish_tasks, name="ai-polish-tasks"),
    path("ai/tasks/<int:pk>/improve/", views.improve_task, name="ai-improve-task"),
    path("ai/tasks/<int:pk>/breakdown/", views.break_down, name="ai-breakdown"),
    path("ai/tasks/<int:pk>/breakdown/apply/", views.apply_breakdown, name="ai-breakdown-apply"),
    path("ai/plan-day/", views.plan_day, name="ai-plan-day"),
    path("ai/prompts/<int:pk>/improve/", views.improve_prompt, name="ai-improve-prompt"),
    path("ai/ideas/<int:pk>/improve/", views.improve_idea, name="ai-improve-idea"),
]
