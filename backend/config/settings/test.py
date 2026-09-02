from .base import *  # noqa: F401,F403

DEBUG = False
SECRET_KEY = "test-secret-key-not-for-production"
ALLOWED_HOSTS = ["*"]
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
SESSION_ENGINE = "django.contrib.sessions.backends.db"
STORAGES["staticfiles"] = {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"}  # noqa: F405
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = dict.fromkeys(REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"], "10000/min")  # noqa: F405
TELEGRAM_BOT_TOKEN = "test-token"
TELEGRAM_WEBHOOK_SECRET = "test-webhook-secret"
LOGGING["handlers"]["console"]["formatter"] = "plain"  # noqa: F405
