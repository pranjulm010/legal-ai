from django.contrib import admin

from .models import Draft, RedlineSuggestion


class RedlineSuggestionInline(admin.TabularInline):
    model = RedlineSuggestion
    extra = 0


@admin.register(Draft)
class DraftAdmin(admin.ModelAdmin):
    list_display = ("title", "firm", "draft_type", "case", "created_by", "updated_at")
    list_filter = ("firm", "draft_type")
    inlines = [RedlineSuggestionInline]


@admin.register(RedlineSuggestion)
class RedlineSuggestionAdmin(admin.ModelAdmin):
    list_display = ("draft", "order", "status")
    list_filter = ("status",)
