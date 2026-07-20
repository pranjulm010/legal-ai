import re
import threading
from pathlib import Path
from typing import List, Optional

from ninja import NinjaAPI, File, Form
from ninja.files import UploadedFile
import requests
from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from accounts.audit import log_audit_event
from accounts.auth import JWTAuth
from accounts.permissions import require_permission
from accounts.rate_limit import rate_limit_exceeded
from cases.models import CaseActivity
from .models import UploadedDocument, ChatMessage, ChatSession
from .schemas import (
    AskQuestionSchema,
    UploadDocumentResponseSchema,
    AskQuestionResponseSchema,
    ChatHistoryResponseSchema,
    ChatSearchResponseSchema,
    ChatSessionDetailSchema,
    ChatSessionListItemSchema,
    ChatSessionRenameSchema,
    CompareDocumentsSchema,
    CompareResultSchema,
    ComplianceCheckSchema,
    DocumentListItemSchema,
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
from rag.document_processor import extract_text_from_document
from rag.rag_pipeline import process_uploaded_document, answer_question, answer_general_question
from rag.research_agent import run_research_agent, run_agent
from rag.vector_store import delete_document_chunks


api = NinjaAPI(title="Legal AI RAG API")


# A question asked WHILE a document is attached that refers to "this type of
# case", "such/similar a case", "cases like this", or "have we handled ...
# this/such/similar case" is about the ATTACHED document's subject, not a
# firm-wide meta breakdown. Reproduced live: with a case file attached, "is
# it we handle this type of case earlier" got hijacked by the firm-stats
# shortcut into a blind category breakdown that ignored the document
# entirely. When this matches and a document is attached, skip the firm-wide
# shortcut so the document-aware agent can read the file, identify its case
# type, and cross-reference the firm's own cases before answering.
_DOC_RELATIVE_CASE_RE = re.compile(
    r"\bthis\s+(?:type|kind|sort)\s+of\s+case\b"
    r"|\b(?:such|similar)\s+(?:a\s+)?cases?\b"
    r"|\bcases?\s+like\s+this\b"
    r"|\blike\s+this\s+case\b"
    r"|\bhandled?\b.*\b(?:this|such|similar)\b.*\bcase"
    r"|\bcase\b.*\b(?:before|earlier|previously)\b",
    re.I,
)


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

    try:
        document = UploadedDocument.objects.create(
            file=file,
            original_name=file.name,
            document_type=document_type,
            case_id=case_id or None,
            firm=request.auth.firm,
            status="processing",
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
def _is_resumable_session(session) -> bool:
    """Only a firm's 5 most recently active chat sessions can be resumed -
    older ones stay visible/searchable in Knowledge but no longer accept
    follow-ups, keeping conversation context bounded."""
    resumable_ids = set(
        ChatSession.objects.filter(firm=session.firm)
        .order_by("-updated_at")
        .values_list("id", flat=True)[:5]
    )
    return session.id in resumable_ids


@api.post(
    "/ask-question/",
    auth=JWTAuth(),
    response={
        200: AskQuestionResponseSchema,
        400: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
    },
)
def ask_question(request, payload: AskQuestionSchema):
    # The agent/RAG path involves LLM calls (sometimes several, per tool
    # use) - cap requests per account so one abusive session can't drive
    # unbounded LLM cost or starve the shared embedding model for every
    # other firm.
    rate_key = f"ask-question:{request.auth.id}"
    if rate_limit_exceeded(rate_key, limit=30, window_seconds=60):
        return 429, {"error": "Too many questions in a short time. Please wait a moment and try again."}

    question = payload.question
    document_id = payload.document_id

    if not question or not question.strip():
        return 400, {
            "error": "Question is required."
        }

    document = None

    if document_id:
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

        if document.status == "processing":
            return 400, {
                "error": "This document is still being processed. Please wait a moment and try again.",
            }

        if document.status == "failed":
            return 400, {
                "error": "This document failed to process and can't be searched.",
                "details": document.error_message,
            }

    session = None

    if payload.chat_session_id:
        try:
            session = ChatSession.objects.get(
                id=payload.chat_session_id, firm=request.auth.firm
            )
        except ChatSession.DoesNotExist:
            return 404, {"error": "Chat session not found."}

        if not _is_resumable_session(session):
            return 400, {"error": "Only your 5 most recent chats can be resumed. Start a new chat instead."}

    # Resuming a session carries its prior Q&A as real conversation turns,
    # so follow-ups like "explain that" or "compare it" make sense.
    history = None
    if session is not None:
        prior = list(
            session.messages.order_by("created_at").values("question", "answer")[:20]
        )
        history = prior or None

    try:
        # Meta-questions about the firm's own data ("how many lawyers",
        # "what's in my drive") must be answered from the database even
        # when a document happens to be selected - selecting a document
        # only scopes *legal-content* questions to it, it doesn't turn
        # every question into one about that document's text.
        #
        # This shortcut only ever answers with FIRM-WIDE totals/listings -
        # it has no concept of case scoping. Reproduced live: asking "show
        # documents/reminders/contacts/lawyers linked to this case" while
        # case_id was set matched this shortcut's generic patterns and
        # silently returned the whole firm's data instead of just this
        # case's - directly contradicting the correct, case-scoped answer
        # the agent's get_case_info tool gives for the same case in the
        # same conversation. When a case is in scope, skip this firm-wide
        # shortcut and let the case-aware agent (which resolves
        # documents/reminders/contacts/lawyers actually linked to THIS
        # case via get_case_info) handle it instead.
        from rag.firm_stats import try_answer_firm_stats

        # "Single result rule": once a query has narrowed the conversation
        # down to one specific case (e.g. "how many open cases" -> exactly
        # one), that case is remembered on the session (see active_case
        # updates below) and treated the same as an explicitly-opened
        # case page for the rest of this conversation - a bare follow-up
        # like "what is it about?"/"who is the client?" then resolves to
        # it without asking the user to repeat its name, AND the firm-wide
        # stats shortcut is correctly skipped for it the same way it
        # already is for an explicit case_id (see the comment below).
        effective_case_id = payload.case_id or (session.active_case_id if session else None)

        # "Collection follow-up rule": a bare "what are they?"/"show
        # them"/"list them" after a firm-stats answer that named a count
        # or list of something should reuse that same collection instead
        # of being treated as a brand-new, unresolvable search - see
        # _resolve_collection_followup's own docstring for the exact
        # mechanism. Only the STATS lookup uses the rewritten text; the
        # user's actual message is still what's stored/shown below.
        from rag.firm_stats import _resolve_collection_followup

        stats_query_text = _resolve_collection_followup(question, history) or question

        # A document-relative "do we handle this type of case" question must
        # NOT be answered by the firm-wide stats shortcut (which would give a
        # blind category breakdown ignoring the attached document); let the
        # document-aware agent handle it instead - see _DOC_RELATIVE_CASE_RE.
        doc_relative = document is not None and bool(_DOC_RELATIVE_CASE_RE.search(question))

        # Semantic-first routing: one intent-router call understands what the
        # user actually wants (an aggregate firm-data question, a genuinely
        # ambiguous request that needs clarifying, or something for the
        # agent), instead of relying on keyword/regex matching. The result is
        # reused by try_answer_firm_stats below so the router runs only once.
        stats_answer = None
        resolved_case_id = None
        is_cases_query = False
        clarification = None

        # When the conversation is already scoped to one specific case, routing
        # always goes to the case-aware agent - so the router call would be
        # wasted. Only run it when a top-level routing decision is actually
        # needed (no active case).
        if not effective_case_id:
            from rag.groq_client import classify_intent

            classification = classify_intent(
                stats_query_text,
                history=history,
                has_document=document is not None,
                has_case=False,
            )

            # Only ask a clarifying question when the intent is genuinely
            # ambiguous (the router is instructed to be conservative and to
            # lean away from clarify when a document is attached).
            if classification.get("intent") == "clarify":
                clarification = str(classification.get("clarification_question", "")).strip() or None

            if clarification is None and not doc_relative:
                stats_answer, resolved_case_id, is_cases_query = try_answer_firm_stats(
                    stats_query_text, request.auth.firm, classification=classification
                )

        if clarification is not None:
            result = {
                "answer": clarification,
                "sources": [],
                "needs_web_confirmation": False,
                "route": "clarification",
                "confidence_level": None,
            }
        elif stats_answer is not None:
            result = {
                "answer": stats_answer,
                "sources": [],
                "needs_web_confirmation": False,
                "route": "firm_database",
                "confidence_level": "High",
            }
            document = None
        elif payload.use_advanced_agent:
            # New tool-calling agent, additive alongside the existing
            # use_agent (sub-question decomposition) path above/below -
            # it can also look up cases, compare documents, and generate
            # drafts, not just retrieve text to answer with.
            result = run_agent(
                question=question,
                firm=request.auth.firm,
                role=request.auth.role,
                created_by=request.auth,
                document_id=str(document.document_id) if document is not None else None,
                case_id=effective_case_id,
                allow_web_search=payload.allow_web_search,
                answer_mode=payload.answer_mode,
                region=payload.region or request.auth.firm.default_region,
                history=history,
            )
        elif document is not None:
            if payload.use_agent:
                result = run_research_agent(
                    question=question,
                    document_id=str(document.document_id),
                    firm_id=document.firm_id,
                    allow_web_search=payload.allow_web_search,
                    answer_mode=payload.answer_mode,
                )
            else:
                result = answer_question(
                    question=question,
                    document_id=str(document.document_id),
                    firm_id=document.firm_id,
                    role=request.auth.role,
                    allow_web_search=payload.allow_web_search,
                    answer_mode=payload.answer_mode,
                    history=history,
                    region=payload.region or request.auth.firm.default_region,
                )
        else:
            # No document selected and not a stats question - search the
            # firm's documents (uploads + Drive-synced), then web (with consent).
            result = answer_general_question(
                question=question,
                firm=request.auth.firm,
                role=request.auth.role,
                allow_web_search=payload.allow_web_search,
                answer_mode=payload.answer_mode,
                history=history,
                region=payload.region or request.auth.firm.default_region,
            )

        if result.get("needs_web_confirmation"):
            return 200, {
                "question": question,
                "answer": result.get("answer", ""),
                "sources": [],
                "chat_id": None,
                "chat_session_id": session.id if session else None,
                "needs_web_confirmation": True,
                "research_steps": result.get("research_steps"),
            }

        answer = result.get("answer", "")
        sources = result.get("sources", [])

        if session is None:
            session = ChatSession.objects.create(
                firm=request.auth.firm,
                started_by=request.auth,
                title=question.strip()[:255],
                document=document,
            )
        else:
            ChatSession.objects.filter(id=session.id).update(updated_at=timezone.now())

        # "Single result rule" bookkeeping (continued from effective_case_id
        # above): remember the one case this turn resolved to, so a bare
        # follow-up next turn ("what is it about?", "who is the client?")
        # can use it without the user repeating its name.
        if is_cases_query:
            # The firm-stats shortcut ran and touched cases - set to
            # whatever it resolved to (None correctly CLEARS a stale
            # active case when the result was ambiguous/zero, per the
            # "multiple results rule").
            session.active_case_id = resolved_case_id
            session.save(update_fields=["active_case"])
        else:
            # Otherwise, only update when the agent itself confirmed a
            # case via get_case_info this turn (its "_sources" always
            # includes {"source_type": "case", "case_id": ...} on
            # success) - never clear active_case just because this turn
            # didn't happen to touch case info at all.
            agent_case_id = next(
                (s.get("case_id") for s in sources if s.get("source_type") == "case" and s.get("case_id")),
                None,
            )
            if agent_case_id:
                session.active_case_id = agent_case_id
                session.save(update_fields=["active_case"])

        chat = ChatMessage.objects.create(
            session=session,
            document=document,
            firm=request.auth.firm,
            question=question,
            answer=answer,
        )

        return 200, {
            "question": question,
            "answer": answer,
            "sources": sources,
            "chat_id": chat.id,
            "chat_session_id": session.id,
            "needs_web_confirmation": False,
            "research_steps": result.get("research_steps"),
            "route": result.get("route"),
            "confidence_level": result.get("confidence_level"),
        }

    except Exception as error:
        # Reproduced live: an upstream LLM provider error (e.g. a Groq
        # rate-limit response) was being forwarded to the client verbatim
        # via str(error) - which for a provider error includes internal
        # details never meant for an end user (org ID, exact token usage,
        # a billing URL). Log the real error server-side for debugging,
        # but only ever show the user a generic, safe message.
        print(f"ASK QUESTION ERROR: {error}")
        return 500, {
            "error": "Something went wrong while generating the answer. Please try again in a moment.",
            "details": None,
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
    A user's resumable chat history, ChatGPT-style - only the 5 most
    recently active sessions (matches the resume limit enforced on the
    detail/ask-question endpoints), newest first.
    """

    sessions = (
        ChatSession.objects.filter(firm=request.auth.firm)
        .order_by("-updated_at")[:5]
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

    if not _is_resumable_session(session):
        return 400, {"error": "Only your 5 most recent chats can be resumed."}

    messages = session.messages.order_by("created_at")

    return 200, {
        "id": session.id,
        "title": session.title,
        "document_id": str(session.document.document_id) if session.document_id else None,
        "document_name": session.document.original_name if session.document_id else None,
        "messages": [
            {"id": m.id, "question": m.question, "answer": m.answer, "created_at": m.created_at}
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
        "version_number": document.version_number,
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

