from __future__ import annotations

from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.people import services
from apps.people.serializers import (
    DelegatorSerializer,
    PersonCreateSerializer,
    PersonSerializer,
    PersonUpdateSerializer,
    PersonUserSerializer,
)


def _person_payload(request, person_id: int) -> dict:
    person = next(row for row in services.people_for(request.user) if row.pk == person_id)
    return PersonSerializer(person, context={"request": request}).data


@api_view(["GET", "POST"])
def people(request):
    """GET: my People with counts. POST: add an account by e-mail (or id) with an optional note. Staff only."""
    services.assert_delegator(request.user)
    if request.method == "POST":
        serializer = PersonCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        person = services.add_person(
            request.user, email=data.get("email") or None, user_id=data.get("user_id"), note=data.get("note", "")
        )
        return Response(_person_payload(request, person.pk), status=status.HTTP_201_CREATED)
    rows = services.people_for(request.user)
    return Response(PersonSerializer(rows, many=True, context={"request": request}).data)


@api_view(["PATCH", "DELETE"])
def person_detail(request, pk: int):
    if request.method == "DELETE":
        services.remove_person(request.user, int(pk))
        return Response(status=status.HTTP_204_NO_CONTENT)
    serializer = PersonUpdateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    person = services.update_person(request.user, int(pk), note=serializer.validated_data["note"])
    return Response(_person_payload(request, person.pk))


@api_view(["GET"])
def search(request):
    """Accounts that can be added to People, by e-mail or name. Staff only."""
    users = services.search_users(request.user, request.query_params.get("q", ""))
    return Response(PersonUserSerializer(users, many=True).data)


@api_view(["GET"])
def delegators(request):
    """Who has handed work to me - one entry per person, with open / done counts."""
    return Response(DelegatorSerializer(services.delegators_for(request.user), many=True).data)
