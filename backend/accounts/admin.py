from django.contrib import admin

from .models import Firm, LawyerProfile


@admin.register(Firm)
class FirmAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_at")


@admin.register(LawyerProfile)
class LawyerProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "firm", "role", "created_at")
    list_filter = ("firm", "role")
