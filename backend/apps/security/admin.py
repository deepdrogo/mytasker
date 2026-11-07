from django.contrib import admin

from apps.security import blocklist
from apps.security.models import BlockedIP, SecurityBotState, SecurityEvent, SignupRecord


@admin.register(BlockedIP)
class BlockedIPAdmin(admin.ModelAdmin):
    list_display = ("network", "source", "is_active", "expires_at", "offenses", "hits", "reason", "updated_at")
    list_filter = ("is_active", "source")
    search_fields = ("network", "reason")
    readonly_fields = ("hits", "last_hit_at", "created_at", "updated_at", "cf_rule_id")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        blocklist._after_change()

    def delete_model(self, request, obj):
        super().delete_model(request, obj)
        blocklist._after_change()


@admin.register(SecurityEvent)
class SecurityEventAdmin(admin.ModelAdmin):
    list_display = ("created_at", "kind", "severity", "ip", "method", "path", "points", "user")
    list_filter = ("kind", "severity")
    search_fields = ("ip", "path", "user_agent")
    date_hierarchy = "created_at"
    raw_id_fields = ("user",)

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(SignupRecord)
class SignupRecordAdmin(admin.ModelAdmin):
    list_display = ("created_at", "user", "ip", "country", "user_agent")
    search_fields = ("ip", "user__email")
    raw_id_fields = ("user",)


@admin.register(SecurityBotState)
class SecurityBotStateAdmin(admin.ModelAdmin):
    list_display = ("owner_username", "owner_user_id", "bound_at")
