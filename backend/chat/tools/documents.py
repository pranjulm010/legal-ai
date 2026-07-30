"""
Knowledge Base RAG retrieval tool: hybrid (vector + exact keyword) search
over the firm's uploaded documents. Threshold-free by design - results
carry their match distances and the model judges relevance itself.
"""
import re
from typing import Dict, List, Optional

from rag.retriever import retrieve_context, retrieve_firm_context
from rag.vector_store import keyword_search_chunks

from .registry import ToolContext, ToolResult, result_json, tool

# Pure vector similarity can miss (or under-rank) an exact term - a section
# number, a docket ID, a specific name - even when it's present verbatim in
# a document. Extracting these "specific-looking" terms and running an
# exact-substring search alongside the vector search (hybrid retrieval) is
# a targeted complement to the vector search, not response routing.
_SECTION_TERM_RE = re.compile(r"\b(?:section|sec\.?|clause|article)\s+\d+[a-zA-Z]*\b", re.I)
_QUOTED_TERM_RE = re.compile(r'"([^"]{3,60})"')
_PROPER_NOUN_RE = re.compile(r"\b(?:[A-Z][a-z]+\s+){0,3}[A-Z][a-z]+\b")

# Question/filler words that are never themselves the thing being looked up.
_QUERY_STOPWORDS = {
    "who", "what", "when", "where", "why", "how", "which", "whom", "whose",
    "is", "are", "was", "were", "am", "be", "been", "being",
    "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "about",
    "with", "by", "from", "as", "at", "into",
    "tell", "me", "give", "show", "explain", "describe", "know", "more",
    "please", "do", "does", "did", "can", "could", "would", "should",
    "i", "we", "you", "my", "our", "your", "this", "that", "these", "those",
    "there", "here", "it", "its", "info", "information", "detail", "details",
    "regarding", "any", "some", "all",
}


def _extract_content_phrases(query: str, max_tokens: int = 3) -> List[str]:
    """Capitalization-independent entity extraction: strip question/filler
    words and keep the short contiguous runs of what's left as candidate
    keyword phrases ("who is ramesh iyer?" -> "ramesh iyer")."""
    tokens = re.findall(r"[A-Za-z0-9][A-Za-z0-9.&/-]*", query)
    phrases = []
    run = []
    for token in tokens:
        if token.lower() in _QUERY_STOPWORDS:
            if run:
                phrases.append(run)
                run = []
        else:
            run.append(token)
    if run:
        phrases.append(run)

    out = []
    for run in phrases:
        if 1 <= len(run) <= max_tokens:
            phrase = " ".join(run)
            if len(phrase) >= 3:
                out.append(phrase)
    return out


def extract_keyword_terms(query: str, max_terms: int = 3) -> List[str]:
    terms = []
    terms.extend(_SECTION_TERM_RE.findall(query))
    terms.extend(_QUOTED_TERM_RE.findall(query))
    if not terms:
        terms.extend(_PROPER_NOUN_RE.findall(query))
    if not terms:
        terms.extend(_extract_content_phrases(query))

    seen = set()
    deduped = []
    for term in terms:
        term = term.strip()
        if len(term) < 3 or term.lower() in seen or term.lower() in _QUERY_STOPWORDS:
            continue
        seen.add(term.lower())
        deduped.append(term)
    return deduped[:max_terms]


def merge_hybrid_chunks(vector_chunks: List[Dict], keyword_chunks: List[Dict], top_k: int) -> List[Dict]:
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


def _build_context(chunks: List[Dict]) -> str:
    """Numbered source-chunk block, deduped by whitespace-normalized text
    (firms often upload the same file twice; identical chunks waste the
    context budget and push different evidence past the cutoff)."""
    parts = []
    seen = set()
    index = 0
    for chunk in chunks:
        text = chunk.get("text", "")
        key = " ".join(text.split()).lower()
        if not key or key in seen:
            continue
        seen.add(key)
        index += 1
        score = chunk.get("score")
        distance = f" (distance {score:.2f})" if isinstance(score, (int, float)) else ""
        parts.append(f"[Source Chunk {index}{distance}]\n{text}")
    return "\n\n".join(parts)


@tool(
    name="search_documents",
    description=(
        "Search the firm's uploaded legal documents (the Knowledge Base). "
        "Searches the currently attached document if there is one; otherwise "
        "the active case's own linked documents; otherwise the firm's whole "
        "collection. Results include vector match distances (lower = closer; "
        "an exact keyword hit shows 0.00) - judge for yourself whether a "
        "result is actually relevant to the question before relying on it."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to search for."},
        },
        "required": ["query"],
    },
)
def search_documents(ctx: ToolContext, query: str) -> ToolResult:
    top_k = 8
    firm_id = ctx.firm.id
    document_id = str(ctx.document.document_id) if ctx.document else None
    case_document_ids = None
    unlinked_firm_wide_fallback = False

    if document_id:
        chunks = retrieve_context(question=query, document_id=document_id, firm_id=firm_id, top_k=top_k)
    elif ctx.case_id:
        from api.models import UploadedDocument

        case_document_ids = list(
            UploadedDocument.objects.filter(case_id=ctx.case_id, firm_id=firm_id).values_list(
                "document_id", flat=True
            )
        )
        if case_document_ids:
            case_chunks = []
            for doc_id in case_document_ids:
                case_chunks.extend(
                    retrieve_context(question=query, document_id=str(doc_id), firm_id=firm_id, top_k=top_k)
                )
            case_chunks.sort(
                key=lambda chunk: chunk.get("score") if chunk.get("score") is not None else float("inf")
            )
            chunks = case_chunks[:top_k]
        else:
            unlinked_firm_wide_fallback = True
            chunks = retrieve_firm_context(question=query, firm_id=firm_id, top_k=top_k)
    else:
        chunks = retrieve_firm_context(question=query, firm_id=firm_id, top_k=top_k)

    keyword_terms = extract_keyword_terms(query)
    if keyword_terms:
        keyword_chunks = _keyword_search_scoped(
            keyword_terms,
            firm_id=firm_id,
            document_id=document_id,
            case_document_ids=case_document_ids,
            top_k=top_k,
        )
        chunks = merge_hybrid_chunks(chunks, keyword_chunks, top_k=top_k)

    fallback_note = (
        "These results are from the firm's whole document collection, NOT "
        "from documents linked to the active case - this case has no "
        "documents of its own. Do not present them as this case's own facts."
        if unlinked_firm_wide_fallback
        else None
    )

    if not chunks:
        # A scoped document that produced no chunks is often not "not
        # relevant" but "never processed" - a scanned PDF whose OCR failed
        # has status="failed" and zero searchable text.
        from api.models import UploadedDocument

        failed_qs = UploadedDocument.objects.filter(firm_id=firm_id, status="failed")
        if document_id:
            failed_qs = failed_qs.filter(document_id=document_id)
        elif ctx.case_id:
            failed_qs = failed_qs.filter(case_id=ctx.case_id)
        else:
            failed_qs = UploadedDocument.objects.none()

        failed_names = list(failed_qs.values_list("original_name", flat=True))
        payload = {"found": False, "context": ""}
        if failed_names:
            payload["note"] = (
                "The document(s) in scope could not be processed and have no "
                f"searchable text: {', '.join(failed_names)}. Tell the user "
                "plainly that this document failed to process - do NOT invent "
                "or guess its contents."
            )
        elif fallback_note:
            payload["note"] = fallback_note
        return ToolResult(content=result_json(payload))

    payload = {"found": True, "context": _build_context(chunks)}
    if fallback_note:
        payload["note"] = fallback_note

    from api.models import UploadedDocument

    chunk_doc_ids = {
        chunk.get("metadata", {}).get("document_id")
        for chunk in chunks
        if chunk.get("metadata", {}).get("document_id")
    }
    names_by_id = {
        str(doc_id): name
        for doc_id, name in UploadedDocument.objects.filter(
            firm_id=firm_id, document_id__in=chunk_doc_ids
        ).values_list("document_id", "original_name")
    }

    sources = [
        {
            "source_type": "document",
            "document_id": chunk.get("metadata", {}).get("document_id"),
            "document_name": names_by_id.get(str(chunk.get("metadata", {}).get("document_id"))),
            "chunk_id": chunk.get("metadata", {}).get("chunk_id"),
            "page_number": chunk.get("metadata", {}).get("page_number") or None,
            "score": chunk.get("score"),
            "preview": chunk.get("text", "")[:300],
        }
        for chunk in chunks
    ]
    return ToolResult(content=result_json(payload), sources=sources)
