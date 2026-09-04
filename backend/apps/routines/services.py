from __future__ import annotations

from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from apps.routines.models import Routine, RoutineCompletion, RoutineItem, Rule, RuleCompletion
from apps.translations.services import request_translation
from common.exceptions import NotFound, ValidationFailed
from common.tz import now_for, today_for

ITEM_FIELDS = {
    "name",
    "description",
    "target_minutes",
    "start_time",
    "end_time",
    "repeat_days",
    "order",
    "counts_as_business",
    "is_active",
}


def get_or_create_routine(user, kind: str) -> Routine:
    if kind not in dict(Routine.Kind.choices):
        raise ValidationFailed("Unknown routine kind.")
    routine, _ = Routine.objects.get_or_create(owner=user, kind=kind, defaults={"name": f"{kind.title()} routine"})
    return routine


def items_for_day(user, kind: str | None, day: date | None = None):
    day = day or today_for(user)
    qs = RoutineItem.objects.filter(routine__owner=user, routine__deleted_at__isnull=True, is_active=True)
    if kind:
        qs = qs.filter(routine__kind=kind)
    weekday = day.weekday()
    return [item for item in qs.select_related("routine") if item.occurs_on(weekday)]


def current_item(user, kind: str | None = None) -> RoutineItem | None:
    """Routine item whose time window contains the user's current local time."""
    now_local = now_for(user)
    current = now_local.time()
    for item in items_for_day(user, kind, now_local.date()):
        if item.start_time and item.end_time:
            if item.start_time <= item.end_time:
                if item.start_time <= current < item.end_time:
                    return item
            elif current >= item.start_time or current < item.end_time:  # overnight window
                return item
    return None


@transaction.atomic
def create_item(user, kind: str, **fields) -> RoutineItem:
    routine = get_or_create_routine(user, kind)
    name = (fields.get("name") or "").strip()
    if not name:
        raise ValidationFailed("Name is required.", fields={"name": ["This field is required."]})
    data = {k: v for k, v in fields.items() if k in ITEM_FIELDS}
    data["name"] = name
    if "order" not in data:
        last = RoutineItem.objects.filter(routine=routine).order_by("-order").values_list("order", flat=True).first()
        data["order"] = (last or 0) + 1
    if kind == Routine.Kind.BUSINESS:
        data.setdefault("counts_as_business", True)
    item = RoutineItem.objects.create(routine=routine, **data)
    request_translation("routine_item", item.pk)
    return item


@transaction.atomic
def update_item(user, item_id: int, **fields) -> RoutineItem:
    item = RoutineItem.objects.select_related("routine").filter(pk=item_id, routine__owner=user).first()
    if item is None:
        raise NotFound("Routine item not found.")
    changed = []
    for key, value in fields.items():
        if key in ITEM_FIELDS:
            if key == "name":
                value = (value or "").strip()
                if not value:
                    raise ValidationFailed("Name is required.", fields={"name": ["This field is required."]})
            setattr(item, key, value)
            changed.append(key)
    if changed:
        item.save(update_fields=[*changed, "updated_at"])
        if {"name", "description"} & set(changed):
            request_translation("routine_item", item.pk)
    return item


@transaction.atomic
def delete_item(user, item_id: int) -> None:
    item = RoutineItem.objects.filter(pk=item_id, routine__owner=user).first()
    if item is None:
        raise NotFound("Routine item not found.")
    item.soft_delete()


@transaction.atomic
def reorder_items(user, kind: str, ordered_ids: list[int]) -> None:
    routine = get_or_create_routine(user, kind)
    items = {item.pk: item for item in RoutineItem.objects.filter(routine=routine, pk__in=ordered_ids)}
    for index, item_id in enumerate(ordered_ids):
        item = items.get(item_id)
        if item is not None and item.order != index:
            item.order = index
            item.save(update_fields=["order"])


@transaction.atomic
def set_completion(
    user, item_id: int, *, completed: bool, day: date | None = None, manual_minutes: int | None = None
):
    item = RoutineItem.objects.filter(pk=item_id, routine__owner=user).first()
    if item is None:
        raise NotFound("Routine item not found.")
    day = day or today_for(user)
    completion, _ = RoutineCompletion.objects.get_or_create(item=item, date=day)
    completion.completed = completed
    completion.completed_at = timezone.now() if completed else None
    if manual_minutes is not None:
        completion.manual_minutes = manual_minutes
    completion.save()
    return completion


def completions_for_day(user, day: date | None = None) -> dict[int, RoutineCompletion]:
    day = day or today_for(user)
    rows = RoutineCompletion.objects.filter(item__routine__owner=user, date=day)
    return {row.item_id: row for row in rows}


# ------------------------------------------------------------------------------- rules

RULE_FIELDS = {"text", "description", "order", "is_enabled"}


@transaction.atomic
def create_rule(user, **fields) -> Rule:
    text = (fields.get("text") or "").strip()
    if not text:
        raise ValidationFailed("Rule text is required.", fields={"text": ["This field is required."]})
    data = {k: v for k, v in fields.items() if k in RULE_FIELDS}
    data["text"] = text
    if "order" not in data:
        last = Rule.objects.filter(owner=user).order_by("-order").values_list("order", flat=True).first()
        data["order"] = (last or 0) + 1
    rule = Rule.objects.create(owner=user, **data)
    request_translation("rule", rule.pk)
    return rule


@transaction.atomic
def update_rule(user, rule_id: int, **fields) -> Rule:
    rule = Rule.objects.filter(pk=rule_id, owner=user).first()
    if rule is None:
        raise NotFound("Rule not found.")
    changed = []
    for key, value in fields.items():
        if key in RULE_FIELDS:
            setattr(rule, key, value)
            changed.append(key)
    if changed:
        rule.save(update_fields=[*changed, "updated_at"])
        if {"text", "description"} & set(changed):
            request_translation("rule", rule.pk)
    return rule


@transaction.atomic
def delete_rule(user, rule_id: int) -> None:
    rule = Rule.objects.filter(pk=rule_id, owner=user).first()
    if rule is None:
        raise NotFound("Rule not found.")
    rule.soft_delete()


@transaction.atomic
def set_rule_kept(user, rule_id: int, *, kept: bool | None, day: date | None = None) -> RuleCompletion | None:
    """
    Mark a rule as kept / broken for a day. `kept=None` clears the mark (back to "not checked").
    """
    rule = Rule.objects.filter(pk=rule_id, owner=user).first()
    if rule is None:
        raise NotFound("Rule not found.")
    day = day or today_for(user)
    if kept is None:
        RuleCompletion.objects.filter(rule=rule, date=day).delete()
        return None
    completion, _ = RuleCompletion.objects.update_or_create(rule=rule, date=day, defaults={"kept": kept})
    return completion


def rule_completions_for_day(user, day: date | None = None) -> dict[int, RuleCompletion]:
    day = day or today_for(user)
    rows = RuleCompletion.objects.filter(rule__owner=user, date=day)
    return {row.rule_id: row for row in rows}


def rule_streaks(user, day: date | None = None) -> dict[int, int]:
    """Consecutive days (ending today or yesterday) each rule was kept."""
    day = day or today_for(user)
    rows = (
        RuleCompletion.objects.filter(rule__owner=user, date__lte=day, date__gte=day - timedelta(days=60))
        .order_by("rule_id", "-date")
        .values_list("rule_id", "date", "kept")
    )
    kept_by_rule: dict[int, set[date]] = {}
    marked_by_rule: dict[int, set[date]] = {}
    for rule_id, d, kept in rows:
        marked_by_rule.setdefault(rule_id, set()).add(d)
        if kept:
            kept_by_rule.setdefault(rule_id, set()).add(d)
    streaks: dict[int, int] = {}
    for rule_id, marked in marked_by_rule.items():
        kept_dates = kept_by_rule.get(rule_id, set())
        # Today may simply not be checked yet - then the streak is counted from yesterday.
        cursor = day if day in marked else day - timedelta(days=1)
        count = 0
        while cursor in kept_dates:
            count += 1
            cursor -= timedelta(days=1)
        streaks[rule_id] = count
    return streaks


@transaction.atomic
def reorder_rules(user, ordered_ids: list[int]) -> None:
    rules = {rule.pk: rule for rule in Rule.objects.filter(owner=user, pk__in=ordered_ids)}
    for index, rule_id in enumerate(ordered_ids):
        rule = rules.get(rule_id)
        if rule is not None and rule.order != index:
            rule.order = index
            rule.save(update_fields=["order"])
