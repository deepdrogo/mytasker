# MyTasker — People: the accounts an administrator hands work to.
# Written and maintained by drogoz · https://github.com/deepdrogo/mytasker

from __future__ import annotations

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class Person(TimeStampedModel):
    """
    A link from an administrator (`owner`) to another account (`user`) they delegate tasks to.

    Delegation itself is just `Task.assignee` on a task the owner owns; this row is what makes the
    target selectable on the People page and carries a free note ("Nino - assistant"). Only staff can
    create it, so only staff can assign work outside a project.
    """

    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="people")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="delegated_from")
    note = models.CharField(max_length=120, blank=True)

    class Meta:
        db_table = "people_person"
        ordering = ["created_at"]
        constraints = [models.UniqueConstraint(fields=["owner", "user"], name="uniq_person_owner_user")]

    def __str__(self) -> str:
        return f"{self.owner_id} -> {self.user_id}"
