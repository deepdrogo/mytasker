from .base import *  # noqa: F401,F403
from .base import env

DEBUG = env("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = ["*"]

CORS_ALLOWED_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", SITE_URL]  # noqa: F405
CSRF_TRUSTED_ORIGINS = list({*CORS_ALLOWED_ORIGINS})

SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}  # noqa: F405

LOGGING["handlers"]["console"]["formatter"] = "plain"  # noqa: F405

# Run Celery tasks eagerly in dev if no broker is available.
CELERY_TASK_ALWAYS_EAGER = env("CELERY_TASK_ALWAYS_EAGER", default=False)
