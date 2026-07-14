from datetime import datetime
from typing import List, Optional

from django.http import HttpResponse
from ninja import Router, Schema

from accounts.audit import log_audit_event
from accounts.auth import JWTAuth
from accounts.permissions import require_permission
from api.models import UploadedDocument
from cases.models import Case, CaseActivity
from rag.document_processor import extract_text_from_document
from rag.drafting import generate_draft, generate_redline_suggestions
from .export import build_docx_bytes, build_pdf_bytes
from .models import Draft, RedlineSuggestion

draft_router = Router(auth=JWTAuth())


class ErrorSchema(Schema):
    error: str


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class GenerateDraftSchema(Schema):
    title: str
    prompt: str
    case_id: Optional[int] = None


class GenerateRedlineSchema(Schema):
    document_id: str
    title: Optional[str] = None
    instructions: str = ""
    case_id: Optional[int] = None


class UpdateDraftSchema(Schema):
    title: Optional[str] = None
    content: Optional[str] = None


class UpdateSuggestionSchema(Schema):
    status: str


class SuggestionSchema(Schema):
    id: int
    order: int
    original_text: str
    suggested_text: str
    reason: str
    status: str


class DraftListItemSchema(Schema):
    id: int
    title: str
    draft_type: str
    case_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class DraftDetailSchema(Schema):
    id: int
    title: str
    draft_type: str
    prompt: str
    content: str
    case_id: Optional[int] = None
    source_document_id: Optional[str] = None
    suggestions: List[SuggestionSchema]
    created_at: datetime
    updated_at: datetime


def _serialize_draft_list_item(draft: Draft) -> dict:
    return {
        "id": draft.id,
        "title": draft.title,
        "draft_type": draft.draft_type,
        "case_id": draft.case_id,
        "created_at": draft.created_at,
        "updated_at": draft.updated_at,
    }


def _serialize_draft_detail(draft: Draft) -> dict:
    return {
        "id": draft.id,
        "title": draft.title,
        "draft_type": draft.draft_type,
        "prompt": draft.prompt,
        "content": draft.content,
        "case_id": draft.case_id,
        "source_document_id": (
            str(draft.source_document.document_id) if draft.source_document_id else None
        ),
        "suggestions": [
            {
                "id": suggestion.id,
                "order": suggestion.order,
                "original_text": suggestion.original_text,
                "suggested_text": suggestion.suggested_text,
                "reason": suggestion.reason,
                "status": suggestion.status,
            }
            for suggestion in draft.suggestions.all().order_by("order")
        ],
        "created_at": draft.created_at,
        "updated_at": draft.updated_at,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@draft_router.get("/", response={200: List[DraftListItemSchema]})
def list_drafts(request, case_id: Optional[int] = None):
    drafts = Draft.objects.filter(firm=request.auth.firm)

    if case_id:
        drafts = drafts.filter(case_id=case_id)

    return [_serialize_draft_list_item(draft) for draft in drafts.order_by("-updated_at")]


# NOTE: literal-path routes (/generate/, /redline/, /suggestions/{id}/) must
# be registered before the dynamic /{draft_id}/ routes below - Django's URL
# resolver tries patterns in registration order, and /{draft_id}/ would
# otherwise greedily capture "generate"/"redline"/"suggestions" as a draft_id.


@draft_router.post(
    "/generate/", response={201: DraftDetailSchema, 400: ErrorSchema, 403: ErrorSchema}
)
def generate_draft_endpoint(request, payload: GenerateDraftSchema):
    denied = require_permission(request, "generate_draft")
    if denied:
        return denied

    case = None

    if payload.case_id:
        try:
            case = Case.objects.get(id=payload.case_id, firm=request.auth.firm)
        except Case.DoesNotExist:
            return 400, {"error": "Case not found for this firm."}

    context = case.description if case else ""
    content = generate_draft(prompt=payload.prompt, context=context)

    draft = Draft.objects.create(
        firm=request.auth.firm,
        case=case,
        draft_type="draft",
        title=payload.title,
        prompt=payload.prompt,
        content=content,
        created_by=request.auth,
    )

    if case:
        CaseActivity.objects.create(
            case=case,
            actor=request.auth,
            activity_type="draft_generated",
            body=f"Draft generated: {draft.title}",
        )

    return 201, _serialize_draft_detail(draft)


@draft_router.post(
    "/redline/",
    response={201: DraftDetailSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def generate_redline_endpoint(request, payload: GenerateRedlineSchema):
    denied = require_permission(request, "generate_draft")
    if denied:
        return denied

    try:
        document = UploadedDocument.objects.get(document_id=payload.document_id)
    except UploadedDocument.DoesNotExist:
        return 400, {"error": "Document not found."}

    if document.firm_id != request.auth.firm_id:
        return 403, {"error": "You do not have access to this document."}

    case = None

    if payload.case_id:
        try:
            case = Case.objects.get(id=payload.case_id, firm=request.auth.firm)
        except Case.DoesNotExist:
            return 400, {"error": "Case not found for this firm."}

    try:
        document_text = extract_text_from_document(
            file_path=document.file.path,
            document_type=document.document_type,
        )
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    suggestions = generate_redline_suggestions(
        document_text=document_text,
        instructions=payload.instructions,
    )

    draft = Draft.objects.create(
        firm=request.auth.firm,
        case=case,
        source_document=document,
        draft_type="redline",
        title=payload.title or f"Redline: {document.original_name}",
        prompt=payload.instructions,
        content=(
            f"Reviewed {len(suggestions)} potential issue(s) in {document.original_name}."
            if suggestions
            else f"No significant issues found in {document.original_name}."
        ),
        created_by=request.auth,
    )

    RedlineSuggestion.objects.bulk_create([
        RedlineSuggestion(
            draft=draft,
            order=index,
            original_text=suggestion["original_text"],
            suggested_text=suggestion["suggested_text"],
            reason=suggestion["reason"],
        )
        for index, suggestion in enumerate(suggestions, start=1)
    ])

    draft.refresh_from_db()

    if case:
        CaseActivity.objects.create(
            case=case,
            actor=request.auth,
            activity_type="draft_generated",
            body=f"Redline review generated: {draft.title}",
        )

    return 201, _serialize_draft_detail(draft)


@draft_router.patch(
    "/suggestions/{suggestion_id}/",
    response={200: SuggestionSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def update_suggestion(request, suggestion_id: int, payload: UpdateSuggestionSchema):
    denied = require_permission(request, "edit_draft")
    if denied:
        return denied

    if payload.status not in dict(RedlineSuggestion.STATUS_CHOICES):
        return 400, {"error": "Invalid status."}

    try:
        suggestion = RedlineSuggestion.objects.select_related("draft").get(
            id=suggestion_id, draft__firm=request.auth.firm
        )
    except RedlineSuggestion.DoesNotExist:
        return 404, {"error": "Suggestion not found."}

    suggestion.status = payload.status
    suggestion.save()

    return 200, {
        "id": suggestion.id,
        "order": suggestion.order,
        "original_text": suggestion.original_text,
        "suggested_text": suggestion.suggested_text,
        "reason": suggestion.reason,
        "status": suggestion.status,
    }


# Dynamic /{draft_id}/ routes must come after all literal-path routes above.


@draft_router.get("/{draft_id}/", response={200: DraftDetailSchema, 404: ErrorSchema})
def get_draft(request, draft_id: int):
    try:
        draft = Draft.objects.prefetch_related("suggestions").get(
            id=draft_id, firm=request.auth.firm
        )
    except Draft.DoesNotExist:
        return 404, {"error": "Draft not found."}

    return 200, _serialize_draft_detail(draft)


# NOTE: /{draft_id}/export/ (a literal suffix on top of the dynamic
# {draft_id}) doesn't collide with the plain /{draft_id}/ route above -
# same route-ordering non-issue as /documents/{document_id}/status/
# elsewhere in this codebase, since the path templates differ by the
# trailing segment.


@draft_router.get("/{draft_id}/export/", response={400: ErrorSchema, 404: ErrorSchema})
def export_draft(request, draft_id: int, format: str = "pdf"):
    try:
        draft = Draft.objects.get(id=draft_id, firm=request.auth.firm)
    except Draft.DoesNotExist:
        return 404, {"error": "Draft not found."}

    file_format = format.lower()
    if file_format not in ("pdf", "docx"):
        return 400, {"error": "format must be 'pdf' or 'docx'."}

    safe_title = "".join(c for c in draft.title if c.isalnum() or c in " -_").strip() or "draft"

    if file_format == "pdf":
        file_bytes = build_pdf_bytes(draft.title, draft.content)
        content_type = "application/pdf"
        filename = f"{safe_title}.pdf"
    else:
        file_bytes = build_docx_bytes(draft.title, draft.content)
        content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        filename = f"{safe_title}.docx"

    response = HttpResponse(file_bytes, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@draft_router.patch(
    "/{draft_id}/", response={200: DraftDetailSchema, 403: ErrorSchema, 404: ErrorSchema}
)
def update_draft(request, draft_id: int, payload: UpdateDraftSchema):
    denied = require_permission(request, "edit_draft")
    if denied:
        return denied

    try:
        draft = Draft.objects.get(id=draft_id, firm=request.auth.firm)
    except Draft.DoesNotExist:
        return 404, {"error": "Draft not found."}

    data = payload.dict(exclude_unset=True)

    for field, value in data.items():
        setattr(draft, field, value)

    draft.save()

    return 200, _serialize_draft_detail(draft)


@draft_router.delete(
    "/{draft_id}/", response={204: None, 403: ErrorSchema, 404: ErrorSchema}
)
def delete_draft(request, draft_id: int):
    denied = require_permission(request, "delete_draft")
    if denied:
        return denied

    try:
        draft = Draft.objects.get(id=draft_id, firm=request.auth.firm)
    except Draft.DoesNotExist:
        return 404, {"error": "Draft not found."}

    draft_title = draft.title
    draft.delete()
    log_audit_event(request.auth.firm, request.auth, "draft_deleted", draft_title)

    return 204, None
