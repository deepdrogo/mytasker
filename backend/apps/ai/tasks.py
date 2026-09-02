from celery import shared_task


@shared_task(name="apps.ai.tasks.expire_pending_actions")
def expire_pending_actions() -> int:
    from apps.ai.services import expire_pending

    return expire_pending()
