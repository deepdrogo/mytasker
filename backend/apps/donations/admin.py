from django.contrib import admin

from apps.donations.models import DonationAddress


@admin.register(DonationAddress)
class DonationAddressAdmin(admin.ModelAdmin):
    list_display = ("asset", "network", "address", "is_active", "order")
    list_editable = ("is_active", "order")
