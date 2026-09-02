from __future__ import annotations

from django.db import models

from common.models import TimeStampedModel


class DonationAddress(TimeStampedModel):
    """Admin-configured crypto donation addresses. No custody, no balances - display only."""

    asset = models.CharField(max_length=20)  # BTC, ETH, USDT ...
    network = models.CharField(max_length=40, blank=True)  # Bitcoin, ERC20, TRC20 ...
    address = models.CharField(max_length=200)
    memo = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True)
    order = models.IntegerField(default=0)

    class Meta:
        db_table = "donations_address"
        ordering = ["order", "asset"]
        constraints = [models.UniqueConstraint(fields=["asset", "network", "address"], name="uniq_donation_address")]

    def __str__(self) -> str:
        return f"{self.asset} ({self.network})" if self.network else self.asset
