import os
from datetime import datetime
from typing import List, Optional

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from ninja import Router, Schema
from rest_framework_simplejwt.tokens import RefreshToken

from .auth import SuperAdminAuth
from .models import Firm, LawyerProfile
from .rate_limit import client_ip, rate_limit_exceeded

super_admin_router = Router()


class ErrorSchema(Schema):
    error: str


class SuperAdminLoginSchema(Schema):
    username: str
    password: str


class SuperAdminTokenSchema(Schema):
    access: str
    refresh: str
    full_name: str


@super_admin_router.post(
    "/login/", response={200: SuperAdminTokenSchema, 401: ErrorSchema, 429: ErrorSchema}
)
def super_admin_login(request, payload: SuperAdminLoginSchema):
    rate_key = f"super-admin-login:{client_ip(request)}:{payload.username}"
    if rate_limit_exceeded(rate_key, limit=8, window_seconds=300):
        return 429, {"error": "Too many login attempts. Please try again in a few minutes."}

    identifier = payload.username.strip()
    username = identifier

    if "@" in identifier:
        matches = User.objects.filter(email__iexact=identifier)
        if matches.count() != 1:
            return 401, {"error": "Invalid credentials."}
        username = matches.first().username

    user = authenticate(request, username=username, password=payload.password)

    if user is None or not user.is_superuser:
        return 401, {"error": "Invalid credentials."}

    refresh = RefreshToken.for_user(user)

    return 200, {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "full_name": user.get_full_name() or user.username,
    }


class FirmSummarySchema(Schema):
    id: int
    name: str
    slug: str
    size: str
    is_active: bool
    lawyer_count: int
    active_lawyer_count: int
    document_count: int
    case_count: int
    draft_count: int
    created_at: datetime


class FirmUpdateSchema(Schema):
    name: Optional[str] = None
    is_active: Optional[bool] = None


class PlatformStatsSchema(Schema):
    total_firms: int
    active_firms: int
    total_lawyers: int
    total_documents: int
    total_ai_queries: int
    total_drafts: int


def _serialize_firm_summary(firm: Firm) -> dict:
    from api.models import UploadedDocument
    from cases.models import Case
    from drafts.models import Draft

    lawyers = firm.lawyers.all()

    return {
        "id": firm.id,
        "name": firm.name,
        "slug": firm.slug,
        "size": firm.size,
        "is_active": firm.is_active,
        "lawyer_count": lawyers.count(),
        "active_lawyer_count": lawyers.filter(user__is_active=True).count(),
        "document_count": UploadedDocument.objects.filter(firm=firm).count(),
        "case_count": Case.objects.filter(firm=firm).count(),
        "draft_count": Draft.objects.filter(firm=firm).count(),
        "created_at": firm.created_at,
    }


@super_admin_router.get(
    "/firms/", auth=SuperAdminAuth(), response={200: List[FirmSummarySchema]}
)
def list_all_firms(request):
    firms = Firm.objects.all().prefetch_related("lawyers__user").order_by("-created_at")
    return [_serialize_firm_summary(firm) for firm in firms]


@super_admin_router.patch(
    "/firms/{firm_id}/",
    auth=SuperAdminAuth(),
    response={200: FirmSummarySchema, 404: ErrorSchema},
)
def update_firm_status(request, firm_id: int, payload: FirmUpdateSchema):
    try:
        firm = Firm.objects.get(id=firm_id)
    except Firm.DoesNotExist:
        return 404, {"error": "Firm not found."}

    data = payload.dict(exclude_unset=True)

    for field, value in data.items():
        setattr(firm, field, value)

    firm.save()

    return 200, _serialize_firm_summary(firm)


@super_admin_router.delete(
    "/firms/{firm_id}/",
    auth=SuperAdminAuth(),
    response={204: None, 404: ErrorSchema},
)
def delete_firm(request, firm_id: int):
    from api.models import UploadedDocument
    from rag.vector_store import get_chroma_client

    try:
        firm = Firm.objects.get(id=firm_id)
    except Firm.DoesNotExist:
        return 404, {"error": "Firm not found."}

    # Firm -> LawyerProfile/Case/Contact/Draft/UploadedDocument/ChatMessage/
    # AuditLog/GoogleDriveConnection all cascade automatically
    # (on_delete=CASCADE), but three things live outside that ORM graph and
    # would otherwise survive the firm being "deleted":
    #
    # 1. LawyerProfile -> User does not cascade in that direction, so login
    #    accounts (username/email/password) would become orphans that
    #    permanently block that email/username from being reused anywhere
    #    on the platform.
    # 2. The physical files behind FileField/ImageField (uploaded documents,
    #    firm logo) - Django deletes the DB row, never the file on disk.
    # 3. The firm's Chroma vector collection - a completely separate
    #    datastore the ORM doesn't know about. Left behind, it's not just
    #    wasted space: if this firm_id is ever reused (SQLite can reuse a
    #    deleted row's rowid), a brand new firm would inherit the old
    #    firm's document embeddings as if they were its own - a real
    #    cross-tenant data leak.
    #
    # Collect everything that needs manual cleanup before the cascade
    # deletes the rows out from under us.
    user_ids = list(
        LawyerProfile.objects.filter(firm=firm).values_list("user_id", flat=True)
    )
    document_paths = [
        doc.file.path
        for doc in UploadedDocument.objects.filter(firm=firm)
        if doc.file
    ]
    logo_path = firm.logo.path if firm.logo else None

    with transaction.atomic():
        firm.delete()
        User.objects.filter(id__in=user_ids).delete()

    try:
        get_chroma_client().delete_collection(name=f"legal_documents_firm_{firm_id}")
    except Exception:
        pass

    for path in document_paths:
        try:
            os.remove(path)
        except OSError:
            pass

    if logo_path:
        try:
            os.remove(logo_path)
        except OSError:
            pass

    return 204, None


@super_admin_router.get(
    "/stats/", auth=SuperAdminAuth(), response={200: PlatformStatsSchema}
)
def platform_stats(request):
    from api.models import ChatMessage, UploadedDocument
    from drafts.models import Draft

    return 200, {
        "total_firms": Firm.objects.count(),
        "active_firms": Firm.objects.filter(is_active=True).count(),
        "total_lawyers": LawyerProfile.objects.count(),
        "total_documents": UploadedDocument.objects.count(),
        "total_ai_queries": ChatMessage.objects.count(),
        "total_drafts": Draft.objects.count(),
    }
