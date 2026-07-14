from django.contrib import admin

from .models import Case, CaseActivity, Reminder


@admin.register(Case)
class CaseAdmin(admin.ModelAdmin):
    list_display = ("title", "firm", "case_type", "status", "client_name", "updated_at")
    list_filter = ("firm", "case_type", "status")
    filter_horizontal = ("assigned_lawyers",)


@admin.register(Reminder)
class ReminderAdmin(admin.ModelAdmin):
    list_display = ("title", "case", "due_date", "is_completed")
    list_filter = ("is_completed",)


@admin.register(CaseActivity)
class CaseActivityAdmin(admin.ModelAdmin):
    list_display = ("case", "activity_type", "actor", "created_at")
    list_filter = ("activity_type",)
