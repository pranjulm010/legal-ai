from django.contrib import admin

from .models import Form


@admin.register(Form)
class FormAdmin(admin.ModelAdmin):
    list_display = ("id", "code", "title", "category", "jurisdiction", "firm")
    search_fields = ("code", "title", "category")
