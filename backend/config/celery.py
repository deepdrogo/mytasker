import logging.config
import os

from celery import Celery
from celery.signals import setup_logging

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("mytasker")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@setup_logging.connect
def _use_django_logging(**_kwargs) -> None:
    """
    Celery hijacks the root logger by default, which would bypass Django's LOGGING config - including
    the RedactSecretsFilter that keeps bot tokens / API keys out of the journal. Reuse Django's config.
    """
    from django.conf import settings

    logging.config.dictConfig(settings.LOGGING)
