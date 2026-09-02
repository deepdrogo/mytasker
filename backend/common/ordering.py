from rest_framework.filters import OrderingFilter


class WhitelistOrderingFilter(OrderingFilter):
    """
    Ordering filter that only honours fields declared in `view.ordering_fields`
    (or `view.ordering_map` for aliases like priority rank). Unknown values are ignored.
    """

    ordering_param = "ordering"

    def get_default_ordering(self, view):
        ordering = getattr(view, "ordering", None)
        ordering_map = getattr(view, "ordering_map", None)
        if not ordering or not ordering_map:
            return ordering
        if isinstance(ordering, str):
            ordering = [ordering]
        return self._map_terms(ordering, ordering_map)

    @staticmethod
    def _map_terms(terms, ordering_map):
        mapped: list[str] = []
        for term in terms:
            desc = term.startswith("-")
            key = term.lstrip("-")
            target = ordering_map.get(key)
            if target is None:
                continue
            if isinstance(target, (list, tuple)):
                mapped.extend([f"-{t.lstrip('-')}" if desc else t for t in target])
            else:
                mapped.append(f"-{target.lstrip('-')}" if desc else target)
        return mapped

    def get_valid_fields(self, queryset, view, context=None):
        ordering_map = getattr(view, "ordering_map", None)
        if ordering_map:
            return [(alias, alias) for alias in ordering_map]
        return super().get_valid_fields(queryset, view, context or {})

    def remove_invalid_fields(self, queryset, fields, view, request):
        ordering_map = getattr(view, "ordering_map", None)
        valid = list(super().remove_invalid_fields(queryset, fields, view, request))
        if not ordering_map:
            return valid
        return self._map_terms(valid, ordering_map)
