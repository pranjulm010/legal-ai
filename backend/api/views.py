import threading
from pathlib import Path
from typing import List, Optional

from ninja import NinjaAPI, File, Form
from ninja.files import UploadedFile
import requests
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from accounts.audit import log_audit_event
from accounts.auth import JWTAuth
from accounts.permissions import require_permission
from accounts.rate_limit import rate_limit_exceeded
from cases.models import CaseActivity
from .models import UploadedDocument, ChatMessage, ChatSession
from .schemas import (
    UploadDocumentResponseSchema,
    ChatHistoryResponseSchema,
    ChatSearchResponseSchema,
    ChatSessionDetailSchema,
    ChatSessionListItemSchema,
    ChatSessionRenameSchema,
    CompareDocumentsSchema,
    CompareResultSchema,
    ComplianceCheckSchema,
    DocumentContentSchema,
    DocumentContentUpdateSchema,
    DocumentListItemSchema,
    DocumentRenameSchema,
    DocumentStatusSchema,
    DocumentSummarySchema,
    DocumentTagsUpdateSchema,
    DocumentVersionItemSchema,
    EntityExtractionSchema,
    ErrorResponseSchema,
    RiskAnalysisSchema,
)
from rag.document_intelligence import (
    MAX_DOCUMENT_CHARS,
    analyze_risks,
    check_compliance,
    compare_documents,
    extract_entities,
    generate_client_summary,
    summarize_document,
)
from rag.document_processor import IMAGE_EXTENSIONS, extract_text_from_document
from rag.rag_pipeline import process_uploaded_document
from rag.vector_store import delete_document_chunks


api = NinjaAPI(title="Legal AI RAG API")


SUPPORTED_DOCUMENT_TYPES = [
    "pdf",
    "docx",
    "txt",
    "md",
    "pptx",
    "jpg",
    "jpeg",
    "png",
]


def get_uploaded_file_type(filename: str) -> str:
    return Path(filename).suffix.lower().replace(".", "")


# Extension-based type detection (get_uploaded_file_type above) only checks
# the filename string - a file named "evil.pdf" that isn't actually a PDF
# would otherwise sail through to the document processor. These are the
# real magic-byte signatures for the types where one exists, checked
# against the file's actual leading bytes. txt/md have no reliable magic
# bytes (any byte sequence can be text) so they're intentionally not
# checked here. Stdlib only - no new dependency.
_FILE_SIGNATURES = {
    "pdf": (b"%PDF-",),
    "docx": (b"PK\x03\x04",),  # DOCX/PPTX are ZIP containers
    "pptx": (b"PK\x03\x04",),
    "jpg": (b"\xff\xd8\xff",),
    "jpeg": (b"\xff\xd8\xff",),
    "png": (b"\x89PNG\r\n\x1a\n",),
}

MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024  # 50MB - comfortably above real legal documents


def _validate_uploaded_file(file, document_type: str) -> Optional[str]:
    """Returns an error message if the file fails validation, else None."""
    if file.size > MAX_UPLOAD_SIZE_BYTES:
        return f"File is too large ({file.size // (1024 * 1024)}MB). Maximum allowed is {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)}MB."

    signatures = _FILE_SIGNATURES.get(document_type)
    if signatures:
        header = file.read(16)
        file.seek(0)  # rewind - the same file object gets read again below for storage/processing
        if not any(header.startswith(sig) for sig in signatures):
            return f"This file's content doesn't match a valid .{document_type} file."

    return None


@api.get("/health/")
def health_check(request):
    return {
        "status": "success",
        "message": "Legal AI RAG MVP backend is running",
    }


def _process_document_in_background(document_id: int) -> None:
    """
    Runs chunking + embedding off the request thread so upload-document can
    return immediately, instead of holding the HTTP connection open for
    however long a large document takes. Large PDFs can easily take 30-40s+
    to embed, which is longer than dev-mode proxies in front of this
    backend (Next.js rewrites, ngrok) are willing to hold a request open
    for - the request would get killed with a generic 500 even though
    processing was still going to succeed. process_uploaded_document()
    itself is untouched; this only adds status bookkeeping around it.
    """
    from django.db import connection

    try:
        document = UploadedDocument.objects.get(id=document_id)
        total_chunks = process_uploaded_document(document)
        document.total_chunks = total_chunks
        document.status = "ready"
        document.save(update_fields=["total_chunks", "status"])
        print("BACKGROUND PROCESSING DONE:", document_id, "chunks:", total_chunks)
    except Exception as error:
        print("BACKGROUND DOCUMENT PROCESSING ERROR:", error)
        try:
            document = UploadedDocument.objects.get(id=document_id)
            document.status = "failed"
            document.error_message = str(error)[:500]
            document.save(update_fields=["status", "error_message"])
        except Exception:
            pass
    finally:
        connection.close()


@api.post(
    "/upload-document/",
    auth=JWTAuth(),
    response={
        201: UploadDocumentResponseSchema,
        400: ErrorResponseSchema,
        409: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def upload_document(
    request,
    file: UploadedFile = File(...),
    user_id: str = Form("anonymous"),
    case_id: Optional[str] = Form(None),
):
    # Embedding generation is CPU/time-expensive - cap uploads per account
    # rather than per-IP, since a firm's whole team can share one office IP.
    rate_key = f"upload-document:{request.auth.id}"
    if rate_limit_exceeded(rate_key, limit=15, window_seconds=300):
        return 429, {"error": "Too many uploads. Please wait a few minutes and try again."}

    if not file:
        return 400, {
            "error": "No file uploaded. Please upload a document."
        }

    print("FILE NAME:", file.name)
    print("USER ID:", user_id)

    document_type = get_uploaded_file_type(file.name)
    print("DOCUMENT TYPE:", document_type)

    if document_type not in SUPPORTED_DOCUMENT_TYPES:
        return 400, {
            "error": "Unsupported document type.",
            "supported_types": SUPPORTED_DOCUMENT_TYPES,
            "note": "For PowerPoint, use .pptx. Old .ppt is not supported in MVP.",
        }

    validation_error = _validate_uploaded_file(file, document_type)
    if validation_error:
        return 400, {"error": validation_error}

    # Reject re-uploading the exact same file into the same firm. Hashing the
    # bytes (not the filename) catches a duplicate even when it's renamed, and
    # lets a genuinely different/updated file through (different bytes ->
    # different hash). This keeps duplicate chunks out of retrieval at the
    # source. Read in chunks so a large file isn't loaded fully into memory,
    # then rewind so the FileField still saves the complete content.
    import hashlib

    file.seek(0)
    hasher = hashlib.sha256()
    for chunk in file.chunks():
        hasher.update(chunk)
    content_hash = hasher.hexdigest()
    file.seek(0)

    existing = (
        UploadedDocument.objects.filter(
            firm=request.auth.firm, content_hash=content_hash
        )
        .exclude(status="failed")
        .order_by("uploaded_at")
        .first()
    )
    if existing is not None:
        return 409, {
            "error": (
                f'This file is already in your knowledge base as '
                f'"{existing.original_name}", so it wasn\'t uploaded again. '
                f"If you meant to replace it, delete the existing one first."
            ),
        }

    try:
        document = UploadedDocument.objects.create(
            file=file,
            original_name=file.name,
            document_type=document_type,
            case_id=case_id or None,
            firm=request.auth.firm,
            status="processing",
            content_hash=content_hash,
        )
    except Exception as error:
        print("UPLOAD DOCUMENT ERROR:", error)
        return 500, {
            "error": "Document upload failed. Please try again.",
            "details": None,
        }

    print("DOCUMENT SAVED:", document.id)

    if document.case_id:
        CaseActivity.objects.create(
            case_id=document.case_id,
            actor=request.auth,
            activity_type="document_uploaded",
            body=f"Document uploaded: {document.original_name}",
        )

    threading.Thread(
        target=_process_document_in_background,
        args=(document.id,),
        daemon=True,
    ).start()

    return 201, {
        "message": "Document uploaded - processing in the background.",
        "document_id": str(document.document_id),
        "file_name": document.original_name,
        "document_type": document.document_type,
        "total_chunks": 0,
        "status": "processing",
    }


@api.get(
    "/documents/chats/search/",
    auth=JWTAuth(),
    response={200: ChatSearchResponseSchema},
)
def search_chat_history(request, q: str = ""):
    """
    Firm-wide searchable chat history (the "Knowledge" page). Registered
    before /documents/{document_id}/chats/ so "search" is never captured as
    a document_id.
    """

    chats = ChatMessage.objects.filter(
        Q(firm=request.auth.firm) | Q(document__firm=request.auth.firm)
    ).select_related("document")

    if q:
        chats = chats.filter(Q(question__icontains=q) | Q(answer__icontains=q))

    chats = chats.order_by("-created_at")[:50]

    # Only the 5 most recently active chat sessions are resumable - older
    # ones still show up in Knowledge search (the Q&A is still visible),
    # but without a resume link.
    resumable_session_ids = set(
        ChatSession.objects.filter(firm=request.auth.firm)
        .order_by("-updated_at")
        .values_list("id", flat=True)[:5]
    )

    return 200, {
        "results": [
            {
                "id": chat.id,
                "question": chat.question,
                "answer": chat.answer,
                "document_id": str(chat.document.document_id) if chat.document_id else None,
                "document_name": chat.document.original_name if chat.document_id else None,
                "chat_session_id": chat.session_id if chat.session_id in resumable_session_ids else None,
                "created_at": chat.created_at,
            }
            for chat in chats
        ]
    }


# NOTE: /chat-sessions/ (literal, list) is registered before the dynamic
# /chat-sessions/{session_id}/ routes below - same route-ordering
# convention used throughout this codebase (see drafts/api.py).


@api.get(
    "/chat-sessions/",
    auth=JWTAuth(),
    response={200: List[ChatSessionListItemSchema]},
)
def list_chat_sessions(request):
    """
    A user's resumable chat history, ChatGPT-style - most recently active
    first. Any session can be resumed; the new pipeline windows history
    itself, so there is no resume limit anymore.
    """

    sessions = (
        ChatSession.objects.filter(firm=request.auth.firm)
        .order_by("-updated_at")[:20]
    )

    results = []
    for session in sessions:
        last_message = session.messages.order_by("-created_at").first()
        results.append({
            "id": session.id,
            "title": session.title or (last_message.question if last_message else "New chat"),
            "message_count": session.messages.count(),
            "last_question": last_message.question if last_message else None,
            "updated_at": session.updated_at,
        })

    return 200, results


@api.get(
    "/chat-sessions/{session_id}/",
    auth=JWTAuth(),
    response={
        200: ChatSessionDetailSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def get_chat_session(request, session_id: int):
    """
    Full message history for a resumable chat session - used to hydrate
    the Ask-a-question page when a lawyer clicks a past conversation from
    the Knowledge page to continue it. Only the firm's 5 most recently
    active sessions are resumable.
    """

    try:
        session = ChatSession.objects.select_related("document").get(id=session_id)
    except ChatSession.DoesNotExist:
        return 404, {"error": "Chat session not found."}

    if session.firm_id != request.auth.firm_id:
        return 403, {"error": "You do not have access to this chat session."}

    messages = list(session.messages.order_by("created_at"))

    # The requester's own thumbs ratings, so reopening a chat shows them.
    from chat.models import MessageFeedback

    feedback_by_message = dict(
        MessageFeedback.objects.filter(
            message__in=messages, user=request.auth
        ).values_list("message_id", "rating")
    )

    return 200, {
        "id": session.id,
        "title": session.title,
        "document_id": str(session.document.document_id) if session.document_id else None,
        "document_name": session.document.original_name if session.document_id else None,
        "messages": [
            {
                "id": m.id,
                "question": m.question,
                "answer": m.answer,
                "created_at": m.created_at,
                "route": m.route,
                "sources": m.sources or [],
                "my_feedback": feedback_by_message.get(m.id),
            }
            for m in messages
        ],
    }


@api.patch(
    "/chat-sessions/{session_id}/",
    auth=JWTAuth(),
    response={
        200: ChatSessionListItemSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def rename_chat_session(request, session_id: int, payload: ChatSessionRenameSchema):
    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return 404, {"error": "Chat session not found."}

    if session.firm_id != request.auth.firm_id:
        return 403, {"error": "You do not have access to this chat session."}

    title = payload.title.strip()
    if not title:
        return 400, {"error": "Title cannot be empty."}

    session.title = title[:255]
    session.save(update_fields=["title"])

    last_message = session.messages.order_by("-created_at").first()

    return 200, {
        "id": session.id,
        "title": session.title,
        "message_count": session.messages.count(),
        "last_question": last_message.question if last_message else None,
        "updated_at": session.updated_at,
    }


@api.delete(
    "/chat-sessions/{session_id}/",
    auth=JWTAuth(),
    response={204: None, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def delete_chat_session(request, session_id: int):
    try:
        session = ChatSession.objects.get(id=session_id)
    except ChatSession.DoesNotExist:
        return 404, {"error": "Chat session not found."}

    if session.firm_id != request.auth.firm_id:
        return 403, {"error": "You do not have access to this chat session."}

    session.delete()

    return 204, None


@api.get(
    "/documents/",
    auth=JWTAuth(),
    response={200: list[DocumentListItemSchema]},
)
def list_documents(request, tag: Optional[str] = None, case_id: Optional[int] = None):
    documents = UploadedDocument.objects.filter(firm=request.auth.firm).select_related("case")

    if tag:
        documents = documents.filter(tags__icontains=tag)

    if case_id:
        documents = documents.filter(case_id=case_id)

    return 200, [
        {
            "document_id": str(document.document_id),
            "file_name": document.original_name,
            "document_type": document.document_type,
            "tags": document.tags,
            "case_id": document.case_id,
            "case_title": document.case.title if document.case_id else None,
            "uploaded_at": document.uploaded_at,
            "source": document.source,
            "status": document.status,
            "error_message": document.error_message,
            "version_number": document.version_number,
        }
        for document in documents.order_by("-uploaded_at")
    ]


@api.patch(
    "/documents/{document_id}/tags/",
    auth=JWTAuth(),
    response={200: DocumentListItemSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def update_document_tags(request, document_id: str, payload: DocumentTagsUpdateSchema):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    document.tags = payload.tags
    document.save(update_fields=["tags"])

    return 200, {
        "document_id": str(document.document_id),
        "file_name": document.original_name,
        "document_type": document.document_type,
        "tags": document.tags,
        "case_id": document.case_id,
        "case_title": document.case.title if document.case_id else None,
        "uploaded_at": document.uploaded_at,
        "source": document.source,
        "status": document.status,
        "error_message": document.error_message,
        "version_number": document.version_number,
    }


@api.patch(
    "/documents/{document_id}/rename/",
    auth=JWTAuth(),
    response={
        200: DocumentListItemSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def rename_document(request, document_id: str, payload: DocumentRenameSchema):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    denied = require_permission(request, "edit_document")
    if denied:
        return denied

    new_name = payload.file_name.strip()
    if not new_name:
        return 400, {"error": "Document name cannot be empty."}

    old_name = document.original_name
    document.original_name = new_name
    document.save(update_fields=["original_name"])

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_renamed",
        details=f"Renamed document: {old_name} -> {new_name}",
    )

    return 200, {
        "document_id": str(document.document_id),
        "file_name": document.original_name,
        "document_type": document.document_type,
        "tags": document.tags,
        "case_id": document.case_id,
        "case_title": document.case.title if document.case_id else None,
        "uploaded_at": document.uploaded_at,
        "source": document.source,
        "status": document.status,
        "error_message": document.error_message,
        "version_number": document.version_number,
    }


@api.get(
    "/documents/{document_id}/content/",
    auth=JWTAuth(),
    response={
        200: DocumentContentSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def get_document_content(request, document_id: str):
    """
    Returns the document's full editable text - the in-app edited override
    if one exists, otherwise the complete text extracted from the original
    file (uncapped, unlike _read_document_text, since the whole document
    has to be shown for editing).
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    if document.edited_text:
        content = document.edited_text
        edited = True
    else:
        try:
            content = extract_text_from_document(
                file_path=document.file.path,
                document_type=document.document_type,
            )
        except (FileNotFoundError, ValueError) as read_error:
            return 400, {"error": f"Could not read document for editing: {read_error}"}
        edited = False

    return 200, {
        "document_id": str(document.document_id),
        "file_name": document.original_name,
        "document_type": document.document_type,
        "content": content,
        "edited": edited,
    }


@api.put(
    "/documents/{document_id}/content/",
    auth=JWTAuth(),
    response={
        200: DocumentContentSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def update_document_content(request, document_id: str, payload: DocumentContentUpdateSchema):
    """
    Saves an in-app content edit as a non-destructive override on the
    document (the original file is left untouched) and re-chunks/re-embeds
    from the new text so search and the AI features reflect the edit. The
    re-embedding runs in the background, so the document goes to
    "processing" until it finishes, exactly like a fresh upload.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    denied = require_permission(request, "edit_document")
    if denied:
        return denied

    content = payload.content.strip()
    if not content:
        return 400, {"error": "Document content cannot be empty."}

    document.edited_text = content
    document.status = "processing"
    document.error_message = ""
    document.save(update_fields=["edited_text", "status", "error_message"])

    # Drop the old chunks now so a failed/slow re-embed can never leave the
    # pre-edit text searchable alongside the new text; the background pass
    # then re-stores from edited_text (see process_uploaded_document).
    delete_document_chunks(document_id=str(document.document_id), firm_id=document.firm_id)

    threading.Thread(
        target=_process_document_in_background,
        args=(document.id,),
        daemon=True,
    ).start()

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_content_edited",
        details=f"Edited content of document: {document.original_name}",
    )

    return 200, {
        "document_id": str(document.document_id),
        "file_name": document.original_name,
        "document_type": document.document_type,
        "content": document.edited_text,
        "edited": True,
    }


def _get_owned_document(request, document_id: str):
    """Shared lookup + firm-ownership check for the document-intelligence
    endpoints below. Returns (document, None) or (None, (status, body))."""
    try:
        document = UploadedDocument.objects.get(document_id=document_id)
    except UploadedDocument.DoesNotExist:
        return None, (404, {"error": "Document not found."})

    if document.firm_id != request.auth.firm_id:
        return None, (403, {"error": "You do not have access to this document."})

    return document, None


# NOTE: /documents/{document_id}/status/ (literal suffix) is registered
# before other /documents/{document_id}/... dynamic routes, same
# route-ordering convention used throughout this codebase (see drafts/api.py).


@api.get(
    "/documents/{document_id}/status/",
    auth=JWTAuth(),
    response={200: DocumentStatusSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def get_document_status(request, document_id: str):
    """
    Polled by the frontend after an upload returns "processing" - lets the
    UI know when background chunking/embedding has finished (or failed)
    without holding the original upload request open.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    return 200, {
        "document_id": str(document.document_id),
        "status": document.status,
        "total_chunks": document.total_chunks,
        "error_message": document.error_message,
    }


@api.post(
    "/documents/{document_id}/reprocess/",
    auth=JWTAuth(),
    response={
        200: DocumentStatusSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def reprocess_document(request, document_id: str):
    """
    Force a document through chunking/embedding again without re-uploading
    it - lets a lawyer retry a "failed" document, or refresh RAG chunks for
    one that looks stale, straight from the Documents page. Mirrors
    update_document_content's re-embed flow: old chunks are dropped first
    so a slow/failed retry can never leave stale chunks sitting next to
    fresh ones, then the same background pipeline used for a fresh upload
    runs again.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    denied = require_permission(request, "edit_document")
    if denied:
        return denied

    if document.status == "processing":
        return 400, {"error": "This document is already being processed."}

    document.status = "processing"
    document.error_message = ""
    document.save(update_fields=["status", "error_message"])

    delete_document_chunks(document_id=str(document.document_id), firm_id=document.firm_id)

    threading.Thread(
        target=_process_document_in_background,
        args=(document.id,),
        daemon=True,
    ).start()

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_reprocessed",
        details=f"Force re-ran RAG processing for document: {document.original_name}",
    )

    return 200, {
        "document_id": str(document.document_id),
        "status": document.status,
        "total_chunks": document.total_chunks,
        "error_message": document.error_message,
    }


_IMAGE_CONTENT_TYPES = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png"}


@api.get(
    "/documents/{document_id}/image/",
    auth=JWTAuth(),
    response={400: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def get_document_image(request, document_id: str):
    """
    Streams the original image bytes for an image-type document so the
    frontend can load it into the in-app image editor. Kept separate from
    /content/ (which returns OCR'd text) since an <img>/canvas needs the
    actual binary, not a JSON payload.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    if document.document_type not in IMAGE_EXTENSIONS:
        return 400, {"error": "This document is not an image."}

    try:
        with document.file.open("rb") as opened:
            data = opened.read()
    except FileNotFoundError:
        return 404, {"error": "Image file not found."}

    content_type = _IMAGE_CONTENT_TYPES.get(document.document_type, "application/octet-stream")
    return HttpResponse(data, content_type=content_type)


@api.post(
    "/documents/{document_id}/image/",
    auth=JWTAuth(),
    response={
        200: DocumentStatusSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
    },
)
def update_document_image(request, document_id: str, file: UploadedFile = File(...)):
    """
    Replaces an image document's binary with an edited version (e.g. from
    the in-app annotation editor) and re-syncs the knowledge base to match:
    the old chunks/embeddings are dropped, edited_text is cleared so the
    background pass re-runs OCR fresh against the new image instead of
    reusing stale text, and the document goes to "processing" until the
    new OCR text is re-chunked and re-embedded - mirrors
    update_document_content's re-embed flow, just for the image-source case.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    denied = require_permission(request, "edit_document")
    if denied:
        return denied

    if document.document_type not in IMAGE_EXTENSIONS:
        return 400, {"error": "Only image documents can be edited this way."}

    new_type = get_uploaded_file_type(file.name) or document.document_type
    if new_type not in IMAGE_EXTENSIONS:
        return 400, {
            "error": "Edited image must be a JPG or PNG.",
            "supported_types": IMAGE_EXTENSIONS,
        }

    validation_error = _validate_uploaded_file(file, new_type)
    if validation_error:
        return 400, {"error": validation_error}

    old_file_name = document.file.name

    document.file = file
    document.document_type = new_type
    document.edited_text = ""
    document.status = "processing"
    document.error_message = ""
    document.save(
        update_fields=["file", "document_type", "edited_text", "status", "error_message"]
    )

    if old_file_name and old_file_name != document.file.name:
        document.file.storage.delete(old_file_name)

    # Drop the old chunks now so a failed/slow re-embed can never leave the
    # pre-edit image's OCR text searchable alongside the new one, same
    # reasoning as update_document_content.
    delete_document_chunks(document_id=str(document.document_id), firm_id=document.firm_id)

    threading.Thread(
        target=_process_document_in_background,
        args=(document.id,),
        daemon=True,
    ).start()

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_image_edited",
        details=f"Edited image of document: {document.original_name}",
    )

    return 200, {
        "document_id": str(document.document_id),
        "status": document.status,
        "total_chunks": document.total_chunks,
        "error_message": document.error_message,
    }


def _read_document_text(document: UploadedDocument) -> str:
    # Capped, unlike the RAG upload/chunking pipeline's own extraction -
    # every caller of this helper (compare/summarize/client-summary/risks/
    # entities/compliance-check) truncates to MAX_DOCUMENT_CHARS before the
    # LLM call anyway (see document_intelligence.py's _truncate), so
    # extracting the WHOLE document first was pure waste - reproduced
    # live: 171s and 23.6M characters extracted from a 33MB PDF for a
    # call that only ever used the first 12000 of them, long enough for
    # the dev proxy to give up and reset the connection before Django
    # could even respond.
    #
    # An in-app content edit is stored as edited_text on the document; when
    # present it's the authoritative text, so read it (capped the same way)
    # instead of re-extracting the untouched original file.
    if document.edited_text:
        return document.edited_text[:MAX_DOCUMENT_CHARS]

    return extract_text_from_document(
        file_path=document.file.path,
        document_type=document.document_type,
        max_chars=MAX_DOCUMENT_CHARS,
    )


# NOTE: /documents/compare/ (literal) is registered before the
# /documents/{document_id}/... dynamic routes below, same route-ordering
# convention used throughout this codebase (see drafts/api.py).


@api.post(
    "/documents/compare/",
    auth=JWTAuth(),
    response={
        200: CompareResultSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def compare_two_documents(request, payload: CompareDocumentsSchema):
    document_a, error = _get_owned_document(request, payload.document_id_a)
    if error:
        return error

    document_b, error = _get_owned_document(request, payload.document_id_b)
    if error:
        return error

    try:
        text_a = _read_document_text(document_a)
        text_b = _read_document_text(document_b)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        comparison = compare_documents(
            text_a, document_a.original_name, text_b, document_b.original_name
        )
    except Exception as error:
        print("COMPARISON ERROR:", error)
        return 500, {"error": "Comparison failed. Please try again.", "details": None}

    return 200, {"comparison": comparison}


@api.post(
    "/documents/{document_id}/summarize/",
    auth=JWTAuth(),
    response={
        200: DocumentSummarySchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def summarize_document_endpoint(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    try:
        text = _read_document_text(document)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        summary = summarize_document(text)
    except Exception as error:
        print("SUMMARIZATION ERROR:", error)
        return 500, {"error": "Summarization failed. Please try again.", "details": None}

    return 200, {"summary": summary}


@api.post(
    "/documents/{document_id}/client-summary/",
    auth=JWTAuth(),
    response={
        200: DocumentSummarySchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def client_summary_endpoint(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    try:
        text = _read_document_text(document)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        summary = generate_client_summary(text)
    except Exception as error:
        print("CLIENT SUMMARY ERROR:", error)
        return 500, {"error": "Client summary generation failed. Please try again.", "details": None}

    return 200, {"summary": summary}


@api.post(
    "/documents/{document_id}/risks/",
    auth=JWTAuth(),
    response={
        200: RiskAnalysisSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def risk_analysis_endpoint(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    try:
        text = _read_document_text(document)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        risks = analyze_risks(text)
    except Exception as error:
        print("RISK ANALYSIS ERROR:", error)
        return 500, {"error": "Risk analysis failed. Please try again.", "details": None}

    return 200, {"risks": risks}


@api.post(
    "/documents/{document_id}/entities/",
    auth=JWTAuth(),
    response={
        200: EntityExtractionSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def entity_extraction_endpoint(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    try:
        text = _read_document_text(document)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        entities = extract_entities(text)
    except Exception as error:
        print("ENTITY EXTRACTION ERROR:", error)
        return 500, {"error": "Entity extraction failed. Please try again.", "details": None}

    document.extracted_entities = entities
    document.save(update_fields=["extracted_entities"])

    return 200, entities


@api.post(
    "/documents/{document_id}/compliance-check/",
    auth=JWTAuth(),
    response={
        200: ComplianceCheckSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def compliance_check_endpoint(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    try:
        text = _read_document_text(document)
    except (FileNotFoundError, ValueError) as error:
        return 400, {"error": f"Could not read document: {error}"}

    try:
        findings = check_compliance(text)
    except Exception as error:
        print("COMPLIANCE CHECK ERROR:", error)
        return 500, {"error": "Compliance check failed. Please try again.", "details": None}

    return 200, {"findings": findings}


@api.get(
    "/documents/{document_id}/chats/",
    auth=JWTAuth(),
    response={
        200: ChatHistoryResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def get_document_chats(request, document_id: str):
    """
    Document chat history endpoint.

    Frontend URL:
    GET /api/documents/{document_id}/chats/
    """

    try:
        document = UploadedDocument.objects.get(document_id=document_id)

    except UploadedDocument.DoesNotExist:
        return 404, {
            "error": "Document not found."
        }

    if document.firm_id != request.auth.firm_id:
        return 403, {
            "error": "You do not have access to this document."
        }

    try:
        chats = ChatMessage.objects.filter(
            document=document
        ).order_by("created_at")

        return 200, {
            "document_id": str(document.document_id),
            "file_name": document.original_name,
            "document_type": document.document_type,
            "chats": [
                {
                    "id": chat.id,
                    "question": chat.question,
                    "answer": chat.answer,
                    "created_at": chat.created_at,
                }
                for chat in chats
            ],
        }

    except Exception as error:
        print("CHAT HISTORY FETCH ERROR:", error)
        return 500, {
            "error": "Chat history fetch failed. Please try again.",
            "details": None,
        }


@api.delete(
    "/documents/{document_id}/",
    auth=JWTAuth(),
    response={204: None, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def delete_document(request, document_id: str):
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    denied = require_permission(request, "delete_document")
    if denied:
        return denied

    document_name = document.original_name
    delete_document_chunks(document_id=str(document.document_id), firm_id=document.firm_id)
    document.file.delete(save=False)
    document.delete()

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_deleted",
        details=f"Deleted document: {document_name}",
    )

    return 204, None


# NOTE: /documents/{document_id}/versions/ and .../new-version/ (literal
# suffixes) are registered here, same route-ordering convention used
# throughout this codebase - they don't collide with the plain
# /documents/{document_id}/... routes since the path template differs by
# the trailing segment.


@api.get(
    "/documents/{document_id}/versions/",
    auth=JWTAuth(),
    response={200: List[DocumentVersionItemSchema], 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def list_document_versions(request, document_id: str):
    """
    Walks a document's version chain in both directions (previous_version
    backward, next_versions forward) to return the full history, oldest
    first - a document with no next_versions is the current one.
    """
    document, error = _get_owned_document(request, document_id)
    if error:
        return error

    chain = [document]

    cursor = document
    while cursor.previous_version_id:
        cursor = cursor.previous_version
        chain.append(cursor)

    cursor = document
    while True:
        next_doc = cursor.next_versions.first()
        if not next_doc:
            break
        chain.append(next_doc)
        cursor = next_doc

    chain.sort(key=lambda doc: doc.version_number)

    return 200, [
        {
            "document_id": str(doc.document_id),
            "file_name": doc.original_name,
            "version_number": doc.version_number,
            "uploaded_at": doc.uploaded_at,
            "status": doc.status,
            "is_current": not doc.next_versions.exists(),
        }
        for doc in chain
    ]


@api.post(
    "/documents/{document_id}/new-version/",
    auth=JWTAuth(),
    response={
        201: UploadDocumentResponseSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def upload_new_document_version(request, document_id: str, file: UploadedFile = File(...)):
    """
    Uploads a new version of an existing document rather than overwriting
    it - creates a new UploadedDocument row (its own document_id, chunks,
    embeddings) linked back via previous_version, so the prior version's
    content stays intact and independently queryable/comparable instead
    of being silently replaced.
    """
    previous, error = _get_owned_document(request, document_id)
    if error:
        return error

    rate_key = f"upload-document:{request.auth.id}"
    if rate_limit_exceeded(rate_key, limit=15, window_seconds=300):
        return 429, {"error": "Too many uploads. Please wait a few minutes and try again."}

    if not file:
        return 400, {"error": "No file uploaded. Please upload a document."}

    document_type = get_uploaded_file_type(file.name)
    if document_type not in SUPPORTED_DOCUMENT_TYPES:
        return 400, {
            "error": "Unsupported document type.",
            "supported_types": SUPPORTED_DOCUMENT_TYPES,
            "note": "For PowerPoint, use .pptx. Old .ppt is not supported in MVP.",
        }

    validation_error = _validate_uploaded_file(file, document_type)
    if validation_error:
        return 400, {"error": validation_error}

    try:
        new_version = UploadedDocument.objects.create(
            file=file,
            original_name=file.name,
            document_type=document_type,
            case_id=previous.case_id,
            firm=request.auth.firm,
            status="processing",
            version_number=previous.version_number + 1,
            previous_version=previous,
        )
    except Exception as error:
        print("NEW VERSION UPLOAD ERROR:", error)
        return 500, {"error": "New version upload failed. Please try again.", "details": None}

    threading.Thread(
        target=_process_document_in_background,
        args=(new_version.id,),
        daemon=True,
    ).start()

    log_audit_event(
        firm=request.auth.firm,
        actor=request.auth,
        action="document_new_version",
        details=f"Uploaded version {new_version.version_number} of: {new_version.original_name}",
    )

    return 201, {
        "message": f"Version {new_version.version_number} uploaded - processing in the background.",
        "document_id": str(new_version.document_id),
        "file_name": new_version.original_name,
        "document_type": new_version.document_type,
        "total_chunks": 0,
        "status": "processing",
    }


# NOTE: /documents/chats/{chat_id}/ (dynamic) is registered after the
# literal /documents/chats/search/ route above - same route-ordering
# convention used throughout this codebase (see drafts/api.py).


@api.delete(
    "/documents/chats/{chat_id}/",
    auth=JWTAuth(),
    response={204: None, 403: ErrorResponseSchema, 404: ErrorResponseSchema},
)
def delete_chat_entry(request, chat_id: int):
    denied = require_permission(request, "delete_chat")
    if denied:
        return denied

    try:
        chat = ChatMessage.objects.select_related("document").get(
            Q(firm=request.auth.firm) | Q(document__firm=request.auth.firm),
            id=chat_id,
        )
    except ChatMessage.DoesNotExist:
        return 404, {"error": "Chat entry not found."}

    chat.delete()

    return 204, None

