"""
Tool implementations for the research agent (see research_agent.py). Each
function wraps an EXISTING capability (document search, web search, draft
generation, document comparison, case lookup) rather than reimplementing
it, and every tool that touches firm-owned data enforces the same
firm-scoping guarantee used everywhere else in this codebase: a query is
never allowed to return another firm's cases, documents, or drafts.
"""
import json
import re
from typing import Dict, List, Optional

from .document_intelligence import compare_documents as _compare_documents_text
from .document_processor import extract_text_from_document
from .drafting import generate_draft as _generate_draft_text
from .retriever import retrieve_context, retrieve_firm_context
from .vector_store import keyword_search_chunks
from .web_search import search_legal_web


def _build_context(chunks: List[Dict]) -> str:
    parts = []
    for index, chunk in enumerate(chunks, start=1):
        parts.append(f"[Source Chunk {index}]\n{chunk['text']}")
    return "\n\n".join(parts)


# Pure vector similarity can miss (or under-rank) an exact term - a section
# number, a docket ID, a specific name - even when it's present verbatim in
# a document. Extracting these "specific-looking" terms and running an
# exact-substring search alongside the vector search (hybrid retrieval) is
# a targeted, low-risk complement rather than replacing the vector search
# outright. Running the WHOLE natural-language question as a substring
# filter would almost never match anything, so only terms that look like
# real identifiers are worth a keyword pass.
_SECTION_TERM_RE = re.compile(r"\b(?:section|sec\.?|clause|article)\s+\d+[a-zA-Z]*\b", re.I)
_QUOTED_TERM_RE = re.compile(r'"([^"]{3,60})"')
_PROPER_NOUN_RE = re.compile(r"\b(?:[A-Z][a-z]+\s+){0,3}[A-Z][a-z]+\b")

# An instruction like "summarize this document" is, semantically, ABOUT the
# document as a whole rather than similar in wording to any one excerpt of
# it - so it systematically scores WORSE (higher vector distance) than even
# an unrelated content question would, since it isn't really a content
# question at all. Reproduced live: "Summarize this document, then draft a
# ..." scored 0.74 against a document explicitly selected by the user - just
# above the 0.72 relevance threshold - and got wrongly treated as "nothing
# relevant found" purely because of this scoring mismatch, not because the
# document was actually unrelated. When the user has explicitly selected a
# specific document AND is asking to act on it as a whole (not asking about
# a specific fact), the relevance threshold doesn't apply - the document's
# own selection is already the grounding.
_WHOLE_DOCUMENT_ACTION_RE = re.compile(
    r"\b(summarize|summarise|explain|analyz?e|review|describe)\b.{0,20}\b(this|the)\s+(document|file|case|contract|agreement)\b"
    r"|\bwhat\s+(is|does)\s+(this|the)\s+(document|file)\b"
    r"|\b(draft|prepare|write)\b.{0,40}\b(based on|from|using)\s+(this|it)\b",
    re.I,
)


def _extract_keyword_terms(query: str, max_terms: int = 2) -> List[str]:
    terms = []
    terms.extend(_SECTION_TERM_RE.findall(query))
    terms.extend(_QUOTED_TERM_RE.findall(query))
    # Proper-noun sequences are the noisiest signal (any capitalized word
    # matches, including sentence-initial words) - only use them if
    # nothing more specific was already found.
    if not terms:
        terms.extend(_PROPER_NOUN_RE.findall(query))
    # De-dupe while preserving order, drop anything too short to be useful.
    seen = set()
    deduped = []
    for term in terms:
        term = term.strip()
        if len(term) < 4 or term.lower() in seen:
            continue
        seen.add(term.lower())
        deduped.append(term)
    return deduped[:max_terms]


def _merge_hybrid_chunks(vector_chunks: List[Dict], keyword_chunks: List[Dict], top_k: int) -> List[Dict]:
    """Keyword (exact-match) hits are surfaced first - a literal string
    match is at least as strong a signal as vector similarity - then
    vector hits fill the rest, deduped by (document_id, chunk_id)."""
    seen = set()
    merged = []

    for chunk in keyword_chunks + vector_chunks:
        metadata = chunk.get("metadata", {})
        key = (metadata.get("document_id"), metadata.get("chunk_id"))
        if key in seen:
            continue
        seen.add(key)
        merged.append(chunk)

    return merged[:top_k]


def _keyword_search_scoped(
    terms: List[str],
    firm_id: int,
    document_id: Optional[str],
    case_document_ids: Optional[List] = None,
    top_k: int = 5,
) -> List[Dict]:
    if not terms:
        return []

    results = []
    for term in terms:
        if document_id:
            results.extend(keyword_search_chunks(term, firm_id=firm_id, document_id=document_id, top_k=top_k))
        elif case_document_ids:
            for doc_id in case_document_ids:
                results.extend(keyword_search_chunks(term, firm_id=firm_id, document_id=str(doc_id), top_k=top_k))
        else:
            results.extend(keyword_search_chunks(term, firm_id=firm_id, top_k=top_k))
    return results


def tool_search_documents(
    query: str,
    firm_id: int,
    document_id: Optional[str] = None,
    case_id: Optional[int] = None,
    top_k: int = 5,
) -> Dict:
    """
    Searches the selected document (if any); otherwise, if a case is
    active in this conversation, searches that case's own linked
    documents first; otherwise falls back to the firm's whole document
    collection. Chroma's stored chunk metadata has no case_id (it's keyed
    by document_id only), so case-scoping is done by resolving the case's
    document IDs first and searching each of them, rather than touching
    the shared vector_store/retriever functions that every other RAG path
    in this codebase also relies on.
    """
    case_document_ids = None
    # True when a case was in scope but had no documents of its own, so we
    # fell back to the firm's whole collection - the caller (the agent's
    # system prompt) needs to know this so it doesn't present a firm-wide
    # match as if it were this specific case's own document. Reproduced
    # live: a case with zero linked documents got a confident, detailed
    # answer built from a completely unrelated document that just happened
    # to be the firm's closest vector match - presented as if it were that
    # case's own facts (case number, court, judge).
    unlinked_firm_wide_fallback = False

    if document_id:
        chunks = retrieve_context(question=query, document_id=document_id, firm_id=firm_id, top_k=top_k)
    elif case_id:
        from api.models import UploadedDocument

        case_document_ids = list(
            UploadedDocument.objects.filter(case_id=case_id, firm_id=firm_id).values_list(
                "document_id", flat=True
            )
        )
        if case_document_ids:
            case_chunks = []
            for doc_id in case_document_ids:
                case_chunks.extend(
                    retrieve_context(question=query, document_id=str(doc_id), firm_id=firm_id, top_k=top_k)
                )
            case_chunks.sort(key=lambda chunk: chunk.get("score") if chunk.get("score") is not None else float("inf"))
            chunks = case_chunks[:top_k]
        else:
            # The active case has no documents of its own - fall back to
            # the firm's whole collection rather than reporting "not
            # found" without ever actually searching anything.
            unlinked_firm_wide_fallback = True
            chunks = retrieve_firm_context(question=query, firm_id=firm_id, top_k=top_k)
    else:
        chunks = retrieve_firm_context(question=query, firm_id=firm_id, top_k=top_k)

    # A Chroma vector query always returns its nearest neighbours even when
    # none of them are actually relevant (e.g. the only document in scope
    # is about something else entirely) - reproduced live: this tool
    # reported found=True for a question totally unrelated to the uploaded
    # document, because "found" only checked whether the chunk LIST was
    # non-empty, not whether the match was actually close. Applying the
    # same relevance-distance threshold the deterministic RAG pipeline
    # uses (rag_pipeline.py/retriever.py) keeps "found" meaning what every
    # caller of this tool already assumes it means.
    from django.conf import settings as _settings

    # A specific document the user explicitly selected is its own grounding
    # for a whole-document action request ("summarize this", "draft
    # something based on it") - the relevance threshold below exists to
    # catch a genuinely UNRELATED topic slipping through as a false
    # "found", not to second-guess the user's own choice of document.
    skip_threshold = bool(document_id) and bool(_WHOLE_DOCUMENT_ACTION_RE.search(query))

    threshold = _settings.RAG_RELEVANCE_DISTANCE_THRESHOLD
    if not skip_threshold:
        chunks = [
            chunk for chunk in chunks
            if chunk.get("score") is not None and chunk.get("score") <= threshold
        ]

    # Hybrid retrieval: an exact-substring pass for any specific-looking
    # terms in the query (section numbers, quoted phrases, proper nouns)
    # merged with the vector results above - catches exact terms vector
    # similarity alone can miss or under-rank.
    keyword_terms = _extract_keyword_terms(query)
    if keyword_terms:
        keyword_chunks = _keyword_search_scoped(
            keyword_terms, firm_id=firm_id, document_id=document_id,
            case_document_ids=case_document_ids, top_k=top_k,
        )
        chunks = _merge_hybrid_chunks(chunks, keyword_chunks, top_k=top_k)

    fallback_note = (
        "These results are from the firm's whole document collection, NOT "
        "from documents linked to the active case - this case has no "
        "documents of its own. Do not present them as this case's own "
        "facts (case number, court, parties, etc.); only mention them as a "
        "separate, clearly-labelled possible match if genuinely relevant."
        if unlinked_firm_wide_fallback else None
    )

    if not chunks:
        result = {"found": False, "context": ""}
        if fallback_note:
            result["note"] = fallback_note
        return result

    return {
        "found": True,
        "context": _build_context(chunks),
        **({"note": fallback_note} if fallback_note else {}),
        "_sources": [
            {
                "source_type": "document",
                "document_id": chunk.get("metadata", {}).get("document_id"),
                "chunk_id": chunk.get("metadata", {}).get("chunk_id"),
                "page_number": chunk.get("metadata", {}).get("page_number") or None,
                "score": chunk.get("score"),
                "preview": chunk.get("text", "")[:300],
            }
            for chunk in chunks
        ],
    }


def tool_search_web(query: str, region: str = "india") -> Dict:
    """Searches trusted regional legal web sources. Caller must have already gated this behind consent."""
    results = search_legal_web(query, region=region)

    if not results:
        return {"found": False, "results": []}

    return {
        "found": True,
        "results": [
            {
                "title": result.get("title"),
                "source_site": result.get("source_site"),
                "snippet": (result.get("snippet") or "")[:500],
            }
            for result in results
        ],
        "_sources": [
            {
                "source_type": "web",
                "source_site": result.get("source_site"),
                "title": result.get("title"),
                "url": result.get("url"),
                "preview": (result.get("snippet") or "")[:300],
            }
            for result in results
        ],
    }


def tool_compare_documents(document_id_a: str, document_id_b: str, firm) -> Dict:
    """Compares two of the firm's own uploaded documents. Refuses documents outside the caller's firm."""
    from api.models import UploadedDocument

    try:
        doc_a = UploadedDocument.objects.get(document_id=document_id_a)
        doc_b = UploadedDocument.objects.get(document_id=document_id_b)
    except UploadedDocument.DoesNotExist:
        return {"error": "One or both documents were not found."}

    if doc_a.firm_id != firm.id or doc_b.firm_id != firm.id:
        return {"error": "You do not have access to one of these documents."}

    text_a = extract_text_from_document(file_path=doc_a.file.path, document_type=doc_a.document_type)
    text_b = extract_text_from_document(file_path=doc_b.file.path, document_type=doc_b.document_type)

    comparison = _compare_documents_text(text_a, doc_a.original_name, text_b, doc_b.original_name)

    return {
        "comparison": comparison,
        "_sources": [
            {"source_type": "compare", "document_id": document_id_a, "document_name": doc_a.original_name},
            {"source_type": "compare", "document_id": document_id_b, "document_name": doc_b.original_name},
        ],
    }


def tool_get_firm_stats(query: str, firm) -> Dict:
    """
    Answers a firm-WIDE aggregate question (total counts, listings,
    breakdowns across cases/documents/lawyers/drafts/contacts/reminders)
    straight from the database, reusing the same never-hallucinated
    firm_stats logic the deterministic pipeline uses for general
    conversations. Only needed by the agent when a case is already active
    in the conversation (case_id set) - in that situation the pre-agent
    firm-stats shortcut is deliberately skipped (see api/views.py) so a
    question about the ACTIVE CASE's own documents/reminders/lawyers isn't
    wrongly answered with firm-wide totals instead. This tool restores the
    ability to answer a genuinely firm-wide question ("how many cases do
    we have in total") without reintroducing that bug, since the model
    only calls it when the question is actually about the whole firm, not
    about the active case.
    """
    from .firm_stats import try_answer_firm_stats

    answer = try_answer_firm_stats(query, firm)
    if answer is None:
        return {"found": False}
    return {"found": True, "answer": answer}


def tool_get_case_info(case_id: Optional[int] = None, title: Optional[str] = None, firm=None) -> Dict:
    """
    Looks up one of the firm's own cases - details, reminders, contacts,
    linked documents, and drafts, so a "tell me about Case1" style
    question gets everything the firm actually has on record instead of
    stopping at just the case name. Firm-scoped.

    Accepts either a numeric case_id (when it's already known, e.g. from
    an active case-scoped conversation) or a free-text title (when the
    user refers to a case only by name and the caller has no ID to give -
    reproduced live: with no title lookup available, a "tell me about
    <case title>" question fell back to a raw document-text search, which
    matched an unrelated document purely by keyword coincidence instead of
    actually finding the case's own database record).
    """
    from cases.models import Case, Contact
    from drafts.models import Draft

    if case_id:
        try:
            case = Case.objects.prefetch_related(
                "assigned_lawyers__user", "reminders", "documents"
            ).get(id=case_id, firm=firm)
        except Case.DoesNotExist:
            return {"error": "Case not found."}
    elif title:
        matches = list(
            Case.objects.prefetch_related("assigned_lawyers__user", "reminders", "documents")
            .filter(firm=firm, title__icontains=title.strip())[:6]
        )
        if not matches:
            return {"error": f"No case found matching the name \"{title}\"."}
        if len(matches) > 1:
            return {
                "error": "Multiple cases match that name - ask the user which one they mean.",
                "matches": [{"case_id": c.id, "title": c.title} for c in matches],
            }
        case = matches[0]
    else:
        return {"error": "No case_id or title given to look up."}

    return {
        "title": case.title,
        "case_type": case.case_type,
        "status": case.status,
        "description": case.description,
        "client_name": case.client_name,
        "drive_link": case.drive_link,
        "assigned_lawyers": [
            profile.user.get_full_name() or profile.user.username
            for profile in case.assigned_lawyers.all()
        ],
        "reminders": [
            {
                "title": reminder.title,
                "due_date": reminder.due_date.isoformat(),
                "is_completed": reminder.is_completed,
            }
            for reminder in case.reminders.all()
        ],
        "contacts": [
            {"name": contact.name, "email": contact.email, "phone": contact.phone}
            for contact in Contact.objects.filter(case=case, firm=firm)
        ],
        "documents": [
            {"document_id": str(doc.document_id), "file_name": doc.original_name}
            for doc in case.documents.all()
        ],
        "drafts": [
            {"draft_id": draft.id, "title": draft.title, "draft_type": draft.draft_type}
            for draft in Draft.objects.filter(case=case, firm=firm)
        ],
        "_sources": [{"source_type": "case", "case_id": case.id, "case_title": case.title}],
    }


def tool_generate_draft(title: str, prompt: str, firm, created_by, case_id: Optional[int] = None) -> Dict:
    """
    Generates a legal draft and saves it to the firm's Drafts, mirroring
    drafts/api.py's generate_draft_endpoint side effects exactly (creates a
    real Draft row, logs a CaseActivity if linked to a case) so a
    draft the agent produces shows up in the Drafts page like any other.
    """
    from cases.models import Case, CaseActivity
    from drafts.models import Draft

    case = None
    if case_id:
        try:
            case = Case.objects.get(id=case_id, firm=firm)
        except Case.DoesNotExist:
            return {"error": "Case not found."}

    context = case.description if case else ""
    content = _generate_draft_text(prompt=prompt, context=context)

    draft = Draft.objects.create(
        firm=firm,
        case=case,
        draft_type="draft",
        title=title,
        prompt=prompt,
        content=content,
        created_by=created_by,
    )

    if case:
        CaseActivity.objects.create(
            case=case,
            actor=created_by,
            activity_type="draft_generated",
            body=f"Draft generated by AI agent: {draft.title}",
        )

    return {
        "draft_id": draft.id,
        "title": draft.title,
        "content": content,
        "_sources": [{"source_type": "draft", "draft_id": draft.id, "draft_title": draft.title}],
    }


# --- Tool schemas (Groq/OpenAI-compatible function-calling format) ---------

SEARCH_DOCUMENTS_TOOL = {
    "type": "function",
    "function": {
        "name": "search_documents",
        "description": (
            "Search the currently selected uploaded document; or, if a case is "
            "active in this conversation, that case's own linked documents "
            "first; or the firm's whole document collection as the final "
            "fallback - for information relevant to a query."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for."},
            },
            "required": ["query"],
        },
    },
}

SEARCH_WEB_TOOL = {
    "type": "function",
    "function": {
        "name": "search_web",
        "description": "Search trusted regional legal web sources for information not found locally.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for."},
            },
            "required": ["query"],
        },
    },
}

REQUEST_WEB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "request_web_search",
        "description": (
            "Call this when local document/database search did not answer the "
            "question and you believe a web search would help, but web search "
            "has not been approved yet. This will ask the user for permission "
            "instead of searching immediately."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "reason": {"type": "string", "description": "One sentence on why a web search would help."},
            },
            "required": ["reason"],
        },
    },
}

COMPARE_DOCUMENTS_TOOL = {
    "type": "function",
    "function": {
        "name": "compare_documents",
        "description": "Compare two of the firm's uploaded documents and summarize the differences.",
        "parameters": {
            "type": "object",
            "properties": {
                "document_id_a": {"type": "string"},
                "document_id_b": {"type": "string"},
            },
            "required": ["document_id_a", "document_id_b"],
        },
    },
}

GET_FIRM_STATS_TOOL = {
    "type": "function",
    "function": {
        "name": "get_firm_stats",
        "description": (
            "Answer a firm-WIDE aggregate question - a total count, a "
            "listing, or a breakdown across ALL of the firm's cases, "
            "documents, lawyers, drafts, contacts, or reminders (e.g. "
            "'how many cases do we have in total', 'list all lawyers'). "
            "Only use this for questions about the whole firm, NOT for "
            "questions about the case currently active in this "
            "conversation - use get_case_info for that instead."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The user's firm-wide question, verbatim."},
            },
            "required": ["query"],
        },
    },
}

GET_CASE_INFO_TOOL = {
    "type": "function",
    "function": {
        "name": "get_case_info",
        "description": (
            "Look up details, reminders, and contacts for one of the firm's "
            "cases. Pass case_id if you already know the numeric ID (e.g. "
            "from an active case-scoped conversation); otherwise pass title "
            "with the case name/label the user used, and it will be resolved "
            "against the firm's own cases."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "case_id": {"type": "integer", "description": "The case's numeric ID, if known."},
                "title": {"type": "string", "description": "The case's name/title, if the numeric ID isn't known."},
            },
        },
    },
}

GENERATE_DRAFT_TOOL = {
    "type": "function",
    "function": {
        "name": "generate_draft",
        "description": (
            "Generate a legal draft document (notice, letter, agreement clause, "
            "etc.) and save it to the firm's Drafts. Only call this when the "
            "user explicitly asks for a document to be drafted/written/prepared "
            "- never as a side effect of answering an informational question."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "prompt": {
                    "type": "string",
                    "description": "Detailed instructions for what the draft should contain.",
                },
                "case_id": {
                    "type": "integer",
                    "description": "Optional - link the draft to a specific case if one is relevant.",
                },
            },
            "required": ["title", "prompt"],
        },
    },
}


def dispatch_tool_call(
    name: str,
    arguments: Dict,
    *,
    firm,
    role: str,
    created_by,
    document_id: Optional[str],
    case_id: Optional[int] = None,
    region: str,
) -> Dict:
    """Runs one tool call by name, always scoped to the caller's own firm."""
    if name == "search_documents":
        return tool_search_documents(
            query=arguments.get("query", ""),
            firm_id=firm.id,
            document_id=document_id,
            case_id=case_id,
        )

    if name == "search_web":
        return tool_search_web(query=arguments.get("query", ""), region=region)

    if name == "compare_documents":
        return tool_compare_documents(
            document_id_a=arguments.get("document_id_a", ""),
            document_id_b=arguments.get("document_id_b", ""),
            firm=firm,
        )

    if name == "get_case_info":
        return tool_get_case_info(case_id=arguments.get("case_id"), title=arguments.get("title"), firm=firm)

    if name == "get_firm_stats":
        return tool_get_firm_stats(query=arguments.get("query", ""), firm=firm)

    if name == "generate_draft":
        return tool_generate_draft(
            title=arguments.get("title", "Untitled Draft"),
            prompt=arguments.get("prompt", ""),
            firm=firm,
            created_by=created_by,
            case_id=arguments.get("case_id"),
        )

    return {"error": f"Unknown tool: {name}"}
