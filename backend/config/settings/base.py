"""
Base Django settings for MyTasker.io.

Environment-specific overrides live in dev.py / prod.py.
"""

from __future__ import annotations

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    SITE_URL=(str, "http://localhost:5173"),
    REDIS_URL=(str, "redis://127.0.0.1:6379"),
    REDIS_CACHE_DB=(int, 1),
    REDIS_BROKER_DB=(int, 2),
    REDIS_CHANNELS_DB=(int, 3),
    ANTHROPIC_API_KEY=(str, ""),
    ANTHROPIC_MODEL=(str, "claude-sonnet-4-5"),
    ANTHROPIC_TIMEOUT_SECONDS=(int, 45),
    TELEGRAM_BOT_TOKEN=(str, ""),
    TELEGRAM_BOT_USERNAME=(str, ""),
    TELEGRAM_WEBHOOK_SECRET=(str, ""),
    EMAIL_URL=(str, "consolemail://"),
    DEFAULT_FROM_EMAIL=(str, "MyTasker <no-reply@mytasker.io>"),
    REQUIRE_EMAIL_VERIFICATION=(bool, False),
    SENTRY_DSN=(str, ""),
    CORS_ALLOWED_ORIGINS=(list, []),
)

_env_file = BASE_DIR / ".env"
if _env_file.exists():
    environ.Env.read_env(str(_env_file))

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")
SITE_URL = env("SITE_URL").rstrip("/")

# ---------------------------------------------------------------------------
# Applications
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "channels",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "django_filters",
    "corsheaders",
    "django_celery_beat",
    "common",
    "apps.accounts",
    "apps.tasks",
    "apps.projects",
    "apps.prompts",
    "apps.routines",
    "apps.time_tracking",
    "apps.collab",
    "apps.sharing",
    "apps.notifications",
    "apps.telegram",
    "apps.ai",
    "apps.analytics",
    "apps.audit",
    "apps.donations",
    "apps.realtime",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "common.middleware.RequestSourceMiddleware",
]

ROOT_URLCONF = "config.urls"
ASGI_APPLICATION = "config.asgi.application"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---------------------------------------------------------------------------
# Database / Cache / Broker
# ---------------------------------------------------------------------------
DATABASES = {
    "default": {
        **env.db("DATABASE_URL"),
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
    }
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL").rstrip("/")
REDIS_CACHE_URL = f"{REDIS_URL}/{env('REDIS_CACHE_DB')}"
REDIS_BROKER_URL = f"{REDIS_URL}/{env('REDIS_BROKER_DB')}"
REDIS_CHANNELS_URL = f"{REDIS_URL}/{env('REDIS_CHANNELS_DB')}"

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_CACHE_URL,
        "KEY_PREFIX": "mt",
        "TIMEOUT": 300,
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_CHANNELS_URL], "capacity": 2000, "expiry": 30},
    }
}

CELERY_BROKER_URL = REDIS_BROKER_URL
CELERY_RESULT_BACKEND = REDIS_BROKER_URL
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = "UTC"
CELERY_ENABLE_UTC = True
CELERY_TASK_ACKS_LATE = True
CELERY_TASK_REJECT_ON_WORKER_LOST = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 300
CELERY_TASK_SOFT_TIME_LIMIT = 240
CELERY_RESULT_EXPIRES = 3600
CELERY_BEAT_SCHEDULER = "django_celery_beat.schedulers:DatabaseScheduler"
CELERY_TASK_DEFAULT_QUEUE = "default"
CELERY_TASK_ROUTES = {
    "apps.telegram.tasks.*": {"queue": "notify"},
    "apps.notifications.tasks.*": {"queue": "notify"},
    "apps.analytics.tasks.*": {"queue": "default"},
}
# Static schedule; DatabaseScheduler picks these up on first run and they can be tuned in admin afterwards.
CELERY_BEAT_SCHEDULE = {
    "reminders-every-minute": {"task": "apps.telegram.tasks.dispatch_due_reminders", "schedule": 60.0},
    "summaries-every-15-min": {"task": "apps.telegram.tasks.dispatch_summaries", "schedule": 15 * 60.0},
    "daily-rollup-hourly": {"task": "apps.analytics.tasks.rollup_daily_summaries", "schedule": 60 * 60.0},
    "telegram-log-cleanup": {"task": "apps.telegram.tasks.cleanup_update_log", "schedule": 6 * 60 * 60.0},
    "ai-actions-expire": {"task": "apps.ai.tasks.expire_pending_actions", "schedule": 30 * 60.0},
}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
AUTH_USER_MODEL = "accounts.User"
LOGIN_URL = "/auth/login"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

SESSION_ENGINE = "django.contrib.sessions.backends.cached_db"
SESSION_COOKIE_NAME = "mt_session"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
CSRF_COOKIE_NAME = "mt_csrf"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_HEADER_NAME = "HTTP_X_CSRFTOKEN"
CSRF_TRUSTED_ORIGINS = [SITE_URL]
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS") or [SITE_URL]
CORS_ALLOW_CREDENTIALS = True

REQUIRE_EMAIL_VERIFICATION = env("REQUIRE_EMAIL_VERIFICATION")
EMAIL_VERIFICATION_MAX_AGE = 60 * 60 * 48
PASSWORD_RESET_MAX_AGE = 60 * 60 * 2

# ---------------------------------------------------------------------------
# REST Framework
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "common.pagination.StandardPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "common.ordering.WhitelistOrderingFilter",
    ],
    "EXCEPTION_HANDLER": "common.exceptions.api_exception_handler",
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": [
        "rest_framework.parsers.JSONParser",
        "rest_framework.parsers.MultiPartParser",
    ],
    "DEFAULT_THROTTLE_CLASSES": [],
    "DEFAULT_THROTTLE_RATES": {
        "anon": "60/min",
        "user": "600/min",
        "auth_login": "10/min",
        "auth_register": "5/hour",
        "auth_password_reset": "5/hour",
        "share_password": "10/min",
        "share_guest": "120/min",
        "ai_command": "30/min",
        "ai_heavy": "20/min",
        "search": "120/min",
    },
    "DATETIME_FORMAT": "iso-8601",
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
}

DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # large prompts

# ---------------------------------------------------------------------------
# i18n / tz
# ---------------------------------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ---------------------------------------------------------------------------
# Static / media
# ---------------------------------------------------------------------------
STATIC_URL = "/backend-static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------
vars().update(env.email_url("EMAIL_URL"))
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL")

# ---------------------------------------------------------------------------
# Integrations
# ---------------------------------------------------------------------------
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = env("ANTHROPIC_MODEL")
ANTHROPIC_TIMEOUT_SECONDS = env("ANTHROPIC_TIMEOUT_SECONDS")
TELEGRAM_BOT_TOKEN = env("TELEGRAM_BOT_TOKEN")
TELEGRAM_BOT_USERNAME = env("TELEGRAM_BOT_USERNAME")
TELEGRAM_WEBHOOK_SECRET = env("TELEGRAM_WEBHOOK_SECRET")
SENTRY_DSN = env("SENTRY_DSN")

# ---------------------------------------------------------------------------
# Domain constants
# ---------------------------------------------------------------------------
PROMPT_SNIPPET_LENGTH = 200
SHARE_TOKEN_BYTES = 32
TELEGRAM_LINK_TOKEN_TTL_SECONDS = 600
MAX_SUBTASK_DEPTH = 1

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
        "plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"},
    },
    "filters": {"redact": {"()": "common.logging.RedactSecretsFilter"}},
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
            "filters": ["redact"],
        }
    },
    "root": {"handlers": ["console"], "level": "INFO"},
    "loggers": {
        "django.request": {"level": "WARNING", "propagate": True},
        "mytasker": {"level": "INFO", "propagate": True},
    },
}
