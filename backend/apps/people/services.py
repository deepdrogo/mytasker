"""People service: who an administrator may hand work to, and who has handed work to me."""

from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Max, Q

from apps.people.models import Person
from apps.tasks.models import Task
from common.exceptions import Forbidden, NotFound, ValidationFailed

OPEN = ~Q(status__in=[Task.Status.DONE, Task.Status.CANCELLED])


def assert_delegator(user) -> None:
    """Only administrators run a People list; everyone else only ever receives."""
    if user is None or not getattr(user, "is_authenticated", False) or not user.is_staff:
        raise Forbidden("Only administrators can delegate tasks.")


def can_delegate_to(owner, assignee_id: int | None) -> bool:
    """True when `owner` has `assignee_id` on their People list (the gate for assigning outside a project)."""
    if assignee_id is None or owner is None:
        return False
    return Person.objects.filter(owner_id=owner.pk, user_id=assignee_id).exists()


def _handed(owner, user):
    """Tasks `owner` handed to `user` (primary or additional assignee), alive."""
    return Task.objects.filter(owner=owner).filter(Q(assignee=user) | Q(assignees=user)).distinct()


def people_for(owner):
    """The owner's People with live counts of what is open / done for each of them."""
    rows = list(Person.objects.filter(owner=owner).select_related("user").order_by("created_at"))
    for person in rows:
        handed = _handed(owner, person.user)
        person.open_count = handed.filter(OPEN).count()
        person.done_count = handed.filter(status=Task.Status.DONE).count()
        person.last_assigned_at = handed.aggregate(m=Max("created_at"))["m"]
    return rows


def search_users(actor_user, term: str, *, limit: int = 8):
    """Accounts an administrator can add, by e-mail or name - assistant accounts included, never themselves."""
    from apps.accounts.models import User

    assert_delegator(actor_user)
    term = (term or "").strip()
    if len(term) < 2:
        return User.objects.none()
    already = Person.objects.filter(owner=actor_user).values_list("user_id", flat=True)
    return (
        User.objects.filter(is_active=True)
        .filter(Q(email__icontains=term) | Q(full_name__icontains=term))
        .exclude(pk=actor_user.pk)
        .exclude(pk__in=already)
        .order_by("full_name", "email")[:limit]
    )


@transaction.atomic
def add_person(actor_user, *, email: str | None = None, user_id: int | None = None, note: str = "") -> Person:
    from apps.accounts.models import User

    assert_delegator(actor_user)
    target = None
    if user_id is not None:
        target = User.objects.filter(pk=user_id, is_active=True).first()
    elif email:
        target = User.objects.filter(email__iexact=email.strip(), is_active=True).first()
    if target is None:
        raise ValidationFailed("No account with that e-mail.", fields={"email": ["Unknown account."]})
    if target.pk == actor_user.pk:
        raise ValidationFailed("You cannot add yourself.", fields={"email": ["That is you."]})
    person, _ = Person.objects.get_or_create(owner=actor_user, user=target, defaults={"note": (note or "")[:120]})
    if note and person.note != note[:120]:
        person.note = note[:120]
        person.save(update_fields=["note", "updated_at"])
    return person


@transaction.atomic
def update_person(actor_user, person_id: int, *, note: str) -> Person:
    assert_delegator(actor_user)
    person = Person.objects.filter(pk=person_id, owner=actor_user).first()
    if person is None:
        raise NotFound("Person not found.")
    person.note = (note or "")[:120]
    person.save(update_fields=["note", "updated_at"])
    return person


@transaction.atomic
def remove_person(actor_user, person_id: int) -> None:
    """Drop the link and take back whatever is still open; finished work keeps its history."""
    assert_delegator(actor_user)
    person = Person.objects.filter(pk=person_id, owner=actor_user).first()
    if person is None:
        raise NotFound("Person not found.")
    for task in _handed(actor_user, person.user).filter(OPEN, project__isnull=True):
        task.assignees.remove(person.user)
        remaining = list(task.assignees.values_list("pk", flat=True))
        Task.objects.filter(pk=task.pk).update(assignee_id=remaining[0] if remaining else None)
    person.delete()


def delegators_for(user):
    """
    Who has handed work to `user`, with counts. Drives the "From <name>" pages: a page exists only while
    that person has given at least one task (open or done).
    """
    from apps.accounts.models import User

    rows = (
        Task.objects.filter(Q(assignee=user) | Q(assignees=user))
        .exclude(owner=user)
        .values("owner_id")
        .annotate(
            open_count=Count("id", filter=OPEN, distinct=True),
            done_count=Count("id", filter=Q(status=Task.Status.DONE), distinct=True),
            last_assigned_at=Max("created_at"),
        )
        .order_by("-last_assigned_at")
    )
    owners = {u.pk: u for u in User.objects.filter(pk__in=[row["owner_id"] for row in rows])}
    return [
        {
            "user": owners[row["owner_id"]],
            "open_count": row["open_count"],
            "done_count": row["done_count"],
            "last_assigned_at": row["last_assigned_at"],
        }
        for row in rows
        if row["owner_id"] in owners
    ]
