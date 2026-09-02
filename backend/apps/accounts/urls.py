from django.urls import path

from apps.accounts import views

urlpatterns = [
    path("csrf/", views.csrf, name="csrf"),
    path("config/", views.config, name="config"),
    path("register/", views.register, name="register"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("me/", views.me, name="me"),
    path("me/preferences/", views.preferences, name="preferences"),
    path("me/notifications/", views.notification_preferences, name="notification-preferences"),
    path("password/change/", views.change_password, name="password-change"),
    path("password/reset/", views.password_reset_request, name="password-reset"),
    path("password/reset/confirm/", views.password_reset_confirm, name="password-reset-confirm"),
    path("email/verify/", views.verify_email, name="email-verify"),
    path("email/resend/", views.resend_verification, name="email-resend"),
]
