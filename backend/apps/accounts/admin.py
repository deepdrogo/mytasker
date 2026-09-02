from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from apps.accounts.models import EmailToken, LoginEvent, User, UserPreference


class UserPreferenceInline(admin.StackedInline):
    model = UserPreference
    can_delete = False
    extra = 0


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    ordering = ["-created_at"]
    list_display = ["email", "full_name", "timezone", "is_active", "is_staff", "email_verified_at", "created_at"]
    list_filter = ["is_active", "is_staff", "is_superuser"]
    search_fields = ["email", "full_name"]
    readonly_fields = ["created_at", "updated_at", "last_login", "last_seen_at"]
    inlines = [UserPreferenceInline]
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("full_name", "timezone", "locale")}),
        ("Status", {"fields": ("is_active", "is_staff", "is_superuser", "email_verified_at")}),
        ("Permissions", {"fields": ("groups", "user_permissions")}),
        ("Timestamps", {"fields": ("last_login", "last_seen_at", "created_at", "updated_at")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2", "full_name", "timezone")}),
    )
    filter_horizontal = ("groups", "user_permissions")


@admin.register(EmailToken)
class EmailTokenAdmin(admin.ModelAdmin):
    list_display = ["user", "purpose", "expires_at", "used_at", "created_at"]
    list_filter = ["purpose"]
    search_fields = ["user__email"]
    readonly_fields = ["token_hash"]


@admin.register(LoginEvent)
class LoginEventAdmin(admin.ModelAdmin):
    list_display = ["user", "success", "source", "created_at"]
    list_filter = ["success", "source"]
    search_fields = ["user__email"]
    readonly_fields = [f.name for f in LoginEvent._meta.fields]
