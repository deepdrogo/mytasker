from django.contrib import admin

from apps.translations.models import Translation


@admin.register(Translation)
class TranslationAdmin(admin.ModelAdmin):
    list_display = ("target_type", "target_id", "status", "source_lang", "attempts", "updated_at")
    list_filter = ("status", "target_type", "source_lang")
    search_fields = ("target_id", "error")
    readonly_fields = ("created_at", "updated_at", "input_tokens", "output_tokens")
    ordering = ("-updated_at",)
