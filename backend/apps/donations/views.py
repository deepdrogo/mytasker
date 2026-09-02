from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from apps.donations.models import DonationAddress


@api_view(["GET"])
@permission_classes([AllowAny])
def addresses(request):
    rows = DonationAddress.objects.filter(is_active=True).values("id", "asset", "network", "address", "memo", "note")
    return Response(list(rows))
