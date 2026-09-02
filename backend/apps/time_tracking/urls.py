from django.urls import path

from apps.time_tracking import views

urlpatterns = [
    path("timer/", views.timer_state, name="timer-state"),
    path("timer/start/", views.start_timer, name="timer-start"),
    path("timer/stop/", views.stop_timer, name="timer-stop"),
    path("timer/entries/", views.entries, name="timer-entries"),
    path("timer/entries/<int:pk>/", views.entry_detail, name="timer-entry-detail"),
    path("timer/entries/<int:pk>/resume/", views.resume_timer, name="timer-resume"),
    path("timer/totals/", views.totals, name="timer-totals"),
    path("sleep/", views.sleep, name="sleep"),
    path("sleep/start/", views.sleep_start, name="sleep-start"),
    path("sleep/stop/", views.sleep_stop, name="sleep-stop"),
    path("sleep/<int:pk>/", views.sleep_detail, name="sleep-detail"),
]
