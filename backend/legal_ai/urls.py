"""
URL configuration for legal_ai project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""

from django.contrib import admin
from django.urls import path
from api.views import api
from accounts.api import router as auth_router, lawyer_router
from accounts.google_drive import google_drive_oauth_callback, google_drive_router
from accounts.super_admin_api import super_admin_router
from cases.api import case_router, reminder_router, dashboard_router, contact_router
from drafts.api import draft_router
from ai_provider.api import settings_router as ai_provider_settings_router

api.add_router("/auth/", auth_router)
api.add_router("/lawyers/", lawyer_router)
api.add_router("/cases/", case_router)
api.add_router("/reminders/", reminder_router)
api.add_router("/dashboard/", dashboard_router)
api.add_router("/drafts/", draft_router)
api.add_router("/contacts/", contact_router)
api.add_router("/super-admin/", super_admin_router)
api.add_router("/integrations/google-drive/", google_drive_router)
api.add_router("/settings/", ai_provider_settings_router)

urlpatterns = [
    path("admin/", admin.site.urls),
    # Plain Django view, not part of the Ninja API - Google redirects the
    # browser here directly with no JWT, so it can't go through JWTAuth.
    path(
        "api/integrations/google-drive/callback/",
        google_drive_oauth_callback,
        name="google_drive_oauth_callback",
    ),
    path("api/", api.urls),
]
