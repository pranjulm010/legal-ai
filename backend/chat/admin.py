from django.contrib import admin

from .models import MemoryEntry, MessageFeedback, UserStyleProfile


@admin.register(MessageFeedback)
class MessageFeedbackAdmin(admin.ModelAdmin):
    list_display = ("id", "message", "user", "rating", "created_at")
    list_filter = ("rating",)


@admin.register(MemoryEntry)
class MemoryEntryAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "kind", "content", "is_active", "created_at")
    list_filter = ("kind", "is_active")
    search_fields = ("content",)


@admin.register(UserStyleProfile)
class UserStyleProfileAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "memory_count_at_refresh", "updated_at")
