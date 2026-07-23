import re
from typing import Dict, List, Optional

from django.conf import settings

from .document_processor import extract_text_from_document
from .chunking import chunk_text
from .vector_store import store_document_chunks
from .retriever import retrieve_context, retrieve_firm_context
from .firm_stats import try_answer_firm_stats
from .groq_client import (
    classify_law_related,
    generate_knowledge_based_answer,
    generate_legal_answer,
    generate_web_grounded_answer,
    is_insufficient_answer,
)
from .web_search import search_legal_web

# --- Retrieval routing engine constants -------------------------------------
# Every answer reports which source actually produced it (the "Source
# Summary" required by the retrieval-routing spec), plus a static
# confidence label per route rather than a computed one - the spec's own
# examples map route -> confidence directly (uploaded document/firm
# database = High, web search = Medium, LLM general knowledge = Low to
# Medium), independent of the underlying similarity score.
ROUTE_UPLOADED_DOCUMENT = "uploaded_document"
ROUTE_FIRM_DATABASE = "firm_database"
ROUTE_WEB_SEARCH = "web_search"
ROUTE_LLM_KNOWLEDGE = "llm_knowledge"

CONFIDENCE_BY_ROUTE = {
    ROUTE_UPLOADED_DOCUMENT: "High",
    ROUTE_FIRM_DATABASE: "High",
    ROUTE_WEB_SEARCH: "Medium",
    ROUTE_LLM_KNOWLEDGE: "Low to Medium",
}

# Deterministic, exact-wording disclaimers - generated in Python rather than
# left to the LLM to phrase, so the required fallback wording is guaranteed
# instead of hoping the model reproduces it consistently.
#
# Disclaimers that follow an ACTUAL web search attempt name the region and
# say explicitly "no such case was found" so it's never confused with the
# LLM's own general-knowledge answer that follows - the two are always
# clearly separated. Disclaimers used when web search was never attempted
# at all (not requested, no consent yet) don't mention web/region, since
# nothing was actually searched there.
_REGION_LABELS = {
    "india": "Indian",
    "usa": "US",
    "uk": "UK",
    "canada": "Canadian",
    "australia": "Australian",
    "singapore": "Singaporean",
    "eu": "EU",
    "middle_east": "Middle Eastern",
}


def _region_label(region: str) -> str:
    return _REGION_LABELS.get(region, (region or "").replace("_", " ").title() or "the selected region's")


def disclaimer_no_web_results(region: str) -> str:
    return (
        f"No such case or matching information was found via web search in trusted "
        f"{_region_label(region)} legal sources. The following answer is based on "
        f"general AI knowledge, not on any specific case or source."
    )


def disclaimer_no_firm_or_web(region: str) -> str:
    return (
        f"No matching information was found in the firm's database, and no such "
        f"case was found via web search in trusted {_region_label(region)} legal "
        f"sources. The following answer is based on general AI knowledge."
    )


def disclaimer_no_doc_firm_or_web(region: str) -> str:
    return (
        f"No relevant information was found in your uploaded documents or your "
        f"firm's database, and no such case was found via web search in trusted "
        f"{_region_label(region)} legal sources. The following answer is based on "
        f"general AI knowledge."
    )

# Phrases that count as the user *explicitly* asking for a web search inside
# their own question wording (e.g. "search the web", "check latest law").
# When present, the routing engine may search the web directly without an
# interactive confirmation step - the explicit wording IS the consent.
_WEB_INTENT_RE = re.compile(
    r"\b("
    r"search (?:the )?web"
    r"|search (?:the )?internet"
    r"|search online"
    r"|look (?:it up )?online"
    r"|look on the web"
    r"|check online"
    r"|check the internet"
    r"|browse the web"
    r"|search outside (?:this|the) document"
    r"|search (?:for )?recent (?:law|laws|judgments?|rulings?|cases?)"
    r"|look for recent (?:law|laws|judgments?|rulings?)"
    r"|check (?:the )?latest law"
    r"|search (?:for )?(?:the )?latest (?:law|laws|judgments?)"
    r"|google (?:this|it)"
    r")\b",
    re.I,
)


def _explicit_web_intent(question: str) -> bool:
    """
    Whether the user's own wording explicitly asked for a web search.
    Regex fast-path first (cheap, no LLM round-trip); if it doesn't match,
    falls back to an LLM classifier so typos and natural phrasings the
    regex can't enumerate (e.g. "get some information from web related to
    this document") are still recognized, instead of only ever matching a
    fixed phrase list. Only runs when the regex already missed, so normal
    questions that never mention the web at all don't pay for an extra
    LLM call.
    """
    if _WEB_INTENT_RE.search(question or ""):
        return True

    from .groq_client import classify_web_search_intent

    return classify_web_search_intent(question)


def process_uploaded_document(document) -> int:
    file_path = document.file.path
    document_id = str(document.document_id)
    document_type = document.document_type

    # An in-app edit stores the new content on the document as a
    # non-destructive override; when present it's the source of truth for
    # chunking/embedding rather than re-extracting the untouched original file.
    extracted_text = getattr(document, "edited_text", "") or extract_text_from_document(
        file_path=file_path,
        document_type=document_type
    )

    chunks = chunk_text(
        text=extracted_text,
        chunk_size=900,
        overlap=150
    )

    total_chunks = store_document_chunks(
        document_id=document_id,
        chunks=chunks,
        firm_id=document.firm_id,
    )

    return total_chunks


def build_context(chunks: List[Dict]) -> str:
    context_parts = []

    for index, chunk in enumerate(chunks, start=1):
        metadata = chunk.get("metadata", {})
        chunk_id = metadata.get("chunk_id", index)

        context_parts.append(
            f"[Source Chunk {chunk_id}]\n{chunk['text']}"
        )

    return "\n\n".join(context_parts)


def build_web_context(results: List[Dict]) -> str:
    context_parts = []

    for index, result in enumerate(results, start=1):
        heading = f"[Web Source {index} - {result.get('source_site', '')}]"
        body = "\n".join(
            part for part in [
                result.get("title", ""),
                result.get("court", ""),
                result.get("snippet", ""),
            ] if part
        )

        context_parts.append(f"{heading}\n{body}")

    return "\n\n".join(context_parts)


def _best_distance(chunks: List[Dict]) -> float:
    distances = [chunk.get("score") for chunk in chunks if chunk.get("score") is not None]
    return min(distances) if distances else float("inf")


def _confidence_percent(score) -> Optional[int]:
    """
    Converts a cosine-distance score (0 = identical, larger = less
    similar) into an intuitive 0-100 confidence percentage for display,
    per the platform's explainability requirement - every answer should
    show how confident the retrieval was, not just a raw distance number.
    """
    if score is None:
        return None
    return max(0, min(100, round((1 - score) * 100)))


def _build_document_sources(chunks: List[Dict]) -> List[Dict]:
    from api.models import UploadedDocument

    document_ids = {chunk.get("metadata", {}).get("document_id") for chunk in chunks}
    document_ids.discard(None)
    document_info = {
        str(doc_id): {"name": name, "source": source}
        for doc_id, name, source in UploadedDocument.objects.filter(
            document_id__in=document_ids
        ).values_list("document_id", "original_name", "source")
    }

    sources = []
    for chunk in chunks:
        metadata = chunk.get("metadata", {})
        doc_id = metadata.get("document_id")
        info = document_info.get(doc_id, {})

        sources.append({
            "source_type": "document",
            "chunk_id": metadata.get("chunk_id"),
            "document_id": doc_id,
            "document_name": info.get("name"),
            "document_source": info.get("source", "upload"),
            "page_number": metadata.get("page_number") or None,
            "score": chunk.get("score"),
            "confidence_percent": _confidence_percent(chunk.get("score")),
            "preview": chunk.get("text", "")[:300],
        })
    return sources


def _web_search_result(question, web_results, answer_mode, history, region, context_label) -> Dict:
    web_context = build_web_context(web_results)
    answer = generate_web_grounded_answer(
        question=question,
        context=web_context,
        mode=answer_mode,
        context_label=context_label,
        history=history,
    )

    sources = [
        {
            "source_type": "web",
            "source_site": result.get("source_site"),
            "title": result.get("title"),
            "url": result.get("url"),
            "preview": result.get("snippet", "")[:300],
        }
        for result in web_results
    ]

    return {
        "answer": answer,
        "sources": sources,
        "needs_web_confirmation": False,
        "route": ROUTE_WEB_SEARCH,
        "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_WEB_SEARCH],
    }


def _llm_knowledge_result(question, answer_mode, history, disclaimer: str) -> Dict:
    answer = generate_knowledge_based_answer(question=question, mode=answer_mode, history=history)
    return {
        "answer": f"{disclaimer}\n\n{answer}",
        "sources": [],
        "needs_web_confirmation": False,
        "route": ROUTE_LLM_KNOWLEDGE,
        "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_LLM_KNOWLEDGE],
    }


# Shown only when we HAD a legal question to answer but the AI service call
# itself failed (e.g. the model provider rate-limited us or was temporarily
# unavailable). Deliberately distinct from a "nothing found in your records"
# message: a transient service failure must never be misreported to the user
# as a data/records problem - that sends them looking in the wrong place.
SERVICE_UNAVAILABLE_MESSAGE = (
    "I couldn't generate an answer just now - the AI service is temporarily "
    "busy or unavailable. Please try again in a little while."
)

# Shown when the question isn't a legal matter at all (sports, coding, general
# trivia, etc.). This assistant only handles legal questions and the firm's
# own records, so a non-legal question is told plainly it's out of scope
# rather than being answered.
NOT_LAW_RELATED_MESSAGE = (
    "This doesn't look like a legal question to me, so I can't help with it "
    "here. I can only assist with legal matters and the firm's own records."
)

# Appended after a general-knowledge legal answer to point the user at a web
# search for anything more current or specific, without running one for them.
WEB_SEARCH_NUDGE = (
    "For the latest or more specific details on this, you can also try a web search."
)

# Shown in "Firm Search" mode when the firm's own records (uploaded documents,
# case files, history) don't contain anything relevant. In this mode the
# assistant deliberately does NOT fall back to a web search or to the model's
# general knowledge - the whole point of the mode is to answer strictly from
# the firm's data - so instead of inventing an answer it says plainly that
# nothing relevant was found.
FIRM_ONLY_NOT_FOUND_MESSAGE = (
    "I couldn't find anything relevant in your firm's records (uploaded "
    "documents, case files, or history) to answer that. In Firm Search mode I "
    "only use the firm's own data - switch to Web Search mode if you'd like a "
    "general-knowledge or web-based answer instead."
)


def firm_not_found_result() -> Dict:
    """The "nothing in the firm's records" reply for Firm Search mode - no web
    or general-knowledge fallback (see FIRM_ONLY_NOT_FOUND_MESSAGE)."""
    return {
        "answer": FIRM_ONLY_NOT_FOUND_MESSAGE,
        "sources": [],
        "needs_web_confirmation": False,
        "route": ROUTE_FIRM_DATABASE,
        "confidence_level": None,
    }


def answer_web_only(
    question: str,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
    region: str = "india",
) -> Dict:
    """
    "Web Search" mode: answer WITHOUT touching any firm data (no uploaded
    documents, no case files, no firm history). Selecting this mode is itself
    the user's consent to search the web, so - unlike the firm paths - this
    never returns needs_web_confirmation.

    Order of preference:
    1. A genuinely non-legal question (sports, trivia, coding, ...) is out of
       scope for this assistant in EVERY mode, so it's turned away plainly
       rather than given a confusing "no web sources" reply.
    2. Otherwise ground the answer in trusted public web sources when they
       actually address the question.
    3. When the web turns up nothing usable - which is common, since the legal
       web search returns legal-site hits even for questions they don't cover
       (e.g. "explain Article 21") - fall back to the model's own general
       knowledge instead of refusing. General knowledge is the baseline in
       this mode; the web is only there to enrich or freshen it.

    Responses stay concise and professional and never reference firm data.
    """
    # (1) Keep the assistant's scope consistent across modes: it only handles
    # legal matters. classify_law_related fails open (returns True on error),
    # so a genuine legal question is never wrongly turned away.
    if not classify_law_related(question):
        return {
            "answer": NOT_LAW_RELATED_MESSAGE,
            "sources": [],
            "needs_web_confirmation": False,
            "route": None,
            "confidence_level": None,
        }

    # (2) Try to ground in public web sources. Unlike the firm paths' strict
    # web-grounding, here an unhelpful web result must NOT block the answer -
    # so if the grounded answer admits the pages didn't cover the question,
    # fall through to general knowledge below.
    web_results = search_legal_web(question, region=region)
    if web_results:
        web_context = build_web_context(web_results)
        web_answer = generate_web_grounded_answer(
            question=question,
            context=web_context,
            mode=answer_mode,
            context_label="general web sources",
            history=history,
        )
        if not is_insufficient_answer(web_answer):
            sources = [
                {
                    "source_type": "web",
                    "source_site": result.get("source_site"),
                    "title": result.get("title"),
                    "url": result.get("url"),
                    "preview": result.get("snippet", "")[:300],
                }
                for result in web_results
            ]
            return {
                "answer": web_answer,
                "sources": sources,
                "needs_web_confirmation": False,
                "route": ROUTE_WEB_SEARCH,
                "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_WEB_SEARCH],
            }

    # (3) No usable web grounding - answer from the model's own general
    # knowledge. generate_knowledge_based_answer already labels its output as
    # general (not firm-sourced) and applies the usual anti-hallucination /
    # disclaimer rules.
    answer = generate_knowledge_based_answer(question=question, mode=answer_mode, history=history)
    return {
        "answer": answer,
        "sources": [],
        "needs_web_confirmation": False,
        "route": ROUTE_LLM_KNOWLEDGE,
        "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_LLM_KNOWLEDGE],
    }


def out_of_scope_result(
    question: str,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
) -> Dict:
    """
    Build the reply for a question local records can't answer.

    - A genuine LEGAL question is ANSWERED from the model's own general legal
      knowledge (generate_knowledge_based_answer already discloses it's general
      info, not the firm's records), followed by a short nudge that a web
      search can surface more current detail.
    - A question that isn't law-related at all is turned away plainly
      (NOT_LAW_RELATED_MESSAGE).

    classify_law_related fails open (returns True on error), so an
    unclassifiable question still gets a helpful legal answer rather than a
    refusal. If answer generation itself fails (e.g. the model provider is
    rate-limited or down), the user is told the service is temporarily
    unavailable - never that "nothing was found", which would be misleading.
    """
    if not classify_law_related(question):
        return {
            "answer": NOT_LAW_RELATED_MESSAGE,
            "sources": [],
            "needs_web_confirmation": False,
            "route": None,
            "confidence_level": None,
        }

    try:
        answer = generate_knowledge_based_answer(
            question=question, mode=answer_mode, history=history
        )
        answer = f"{answer}\n\n{WEB_SEARCH_NUDGE}"
        route = ROUTE_LLM_KNOWLEDGE
    except Exception as error:
        # A service/rate-limit failure is NOT the same as "not in the records".
        # Log the real cause for debugging (it was previously swallowed
        # silently) and tell the user the truth: the service is temporarily
        # unavailable, so they retry rather than assume their data is missing.
        print(f"out_of_scope_result: general-knowledge generation failed: {error}")
        answer = SERVICE_UNAVAILABLE_MESSAGE
        route = None

    return {
        "answer": answer,
        "sources": [],
        "needs_web_confirmation": False,
        "route": route,
        "confidence_level": CONFIDENCE_BY_ROUTE[route] if route else None,
    }


def out_of_scope_answer(
    question: str,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
) -> str:
    """Just the answer TEXT for an out-of-scope question - see
    out_of_scope_result. Used by callers (e.g. the research agent) that build
    their own result dict and only need the message body."""
    return out_of_scope_result(question, answer_mode, history)["answer"]


def _ask_web_consent(
    question: str,
    chunks: List[Dict],
    best_distance: float,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
) -> Dict:
    """
    "Nothing found locally" response - used everywhere local search (uploaded
    document and/or firm database) comes up empty and the question doesn't
    already contain an explicit web-search request, for both General Public and
    Lawyer roles.

    If there's a near-miss firm document worth pointing at, _nearest_document_note
    suggests it (that's firm-specific and beats a generic answer). Otherwise the
    question is out of scope for the firm's records, so out_of_scope_result
    handles it: a genuine legal question is answered from general legal
    knowledge, a non-legal one is turned away. Still does not run a web search
    on the user's behalf.
    """
    note = _nearest_document_note(chunks, best_distance)
    if note:
        return {
            "answer": note,
            "sources": [],
            "needs_web_confirmation": False,
            "route": None,
            "confidence_level": None,
        }
    return out_of_scope_result(question, answer_mode, history)


def answer_question(
    question: str,
    document_id: str,
    firm_id: int,
    role: str = "lawyer",
    allow_web_search: bool = False,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
    region: str = "india",
    firm_only: bool = False,
) -> Dict:
    """
    Retrieval routing for a question scoped to one uploaded document.

    General Public: Uploaded Document -> (ask consent, unless the question
    already explicitly asked for a web search) Web -> LLM Knowledge. Public
    users never get a firm-wide database search - there is no "firm"
    concept for them, only their own uploaded document(s).

    Lawyer: Uploaded Document -> Firm Database -> (ask consent, unless
    explicit) Web -> LLM Knowledge. Stops at the first source that actually
    answers the question; every other source is left untouched once one
    succeeds. Both roles always ask before searching the web unless the
    question itself already made an explicit request.
    """
    is_public = role == "public"

    chunks = retrieve_context(
        question=question,
        document_id=document_id,
        firm_id=firm_id,
        top_k=5
    )

    threshold = settings.RAG_RELEVANCE_DISTANCE_THRESHOLD
    best_distance = _best_distance(chunks)
    local_match_found = bool(chunks) and best_distance <= threshold

    if local_match_found:
        context = build_context(chunks)
        answer = generate_legal_answer(
            question=question,
            context=context,
            mode=answer_mode,
            context_label="The uploaded document",
            history=history,
        )
        # A chunk can pass the distance threshold without actually
        # answering the question - trust the model's own admission over
        # the embedding-distance heuristic and fall through instead.
        if not is_insufficient_answer(answer):
            sources = []
            for chunk in chunks:
                metadata = chunk.get("metadata", {})
                sources.append({
                    "source_type": "document",
                    "chunk_id": metadata.get("chunk_id"),
                    "page_number": metadata.get("page_number") or None,
                    "score": chunk.get("score"),
                    "confidence_percent": _confidence_percent(chunk.get("score")),
                    "preview": chunk.get("text", "")[:300],
                })

            return {
                "answer": answer,
                "sources": sources,
                "needs_web_confirmation": False,
                "route": ROUTE_UPLOADED_DOCUMENT,
                "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_UPLOADED_DOCUMENT],
            }

    # The uploaded document didn't answer it.
    explicit_web = _explicit_web_intent(question)

    if is_public:
        # Firm Search mode: the uploaded document is the only source a public
        # user has, and it didn't answer - so there's nothing more to try. No
        # web / general-knowledge fallback in this mode.
        if firm_only:
            return firm_not_found_result()

        # No firm-database step for the general public - go straight to
        # web. An explicit request in the question is treated as consent
        # already given; otherwise ask first before searching.
        if explicit_web or allow_web_search:
            web_results = search_legal_web(question, region=region)
            if web_results:
                return _web_search_result(
                    question, web_results, answer_mode, history, region,
                    context_label="the uploaded document",
                )
            return _llm_knowledge_result(question, answer_mode, history, disclaimer_no_web_results(region))

        return _ask_web_consent(question, chunks, best_distance, answer_mode, history)

    # Lawyer: before asking to search the web, check whether the answer is
    # sitting in a different document the firm already has.
    firm_chunks = retrieve_firm_context(question=question, firm_id=firm_id, top_k=5)
    firm_best_distance = _best_distance(firm_chunks)
    firm_match_found = bool(firm_chunks) and firm_best_distance <= threshold

    if firm_match_found:
        firm_context = build_context(firm_chunks)
        firm_answer = generate_legal_answer(
            question=question,
            context=firm_context,
            mode=answer_mode,
            context_label="Your firm's documents",
            history=history,
        )
        if not is_insufficient_answer(firm_answer):
            return {
                "answer": firm_answer,
                "sources": _build_document_sources(firm_chunks),
                "needs_web_confirmation": False,
                "route": ROUTE_FIRM_DATABASE,
                "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_FIRM_DATABASE],
            }

    # Nothing in the document or the firm's database. In Firm Search mode we
    # stop here rather than reaching for the web or general knowledge.
    if firm_only:
        return firm_not_found_result()

    # An explicit request in the question itself counts as consent; otherwise
    # ask first.
    if not (explicit_web or allow_web_search):
        return _ask_web_consent(question, firm_chunks, firm_best_distance, answer_mode, history)

    web_results = search_legal_web(question, region=region)

    if not web_results:
        return _llm_knowledge_result(question, answer_mode, history, disclaimer_no_doc_firm_or_web(region))

    return _web_search_result(
        question, web_results, answer_mode, history, region,
        context_label="your uploaded documents or firm database",
    )


def _nearest_document_note(chunks: List[Dict], best_distance: float) -> str:
    """
    When local search didn't produce a confident direct answer, some of
    the retrieved chunks might still be genuinely related-but-different
    cases (e.g. someone else's police complaint about a similar theft)
    rather than pure noise. Surface every document among the retrieved
    chunks that's close enough to be worth mentioning - not just the
    single nearest one - so the fallback doesn't look like a dead end and
    the user can see everything on-topic that was actually found. They
    can then ask to have any of them explained, or ask to compare one
    against a document of their own, instead of only being offered a web
    search.
    """
    # By the time this runs, the chunk already failed to produce a
    # confident direct answer (see RAG_RELEVANCE_DISTANCE_THRESHOLD, 0.72).
    # Suggesting it as "a similar case" needs a tighter bar than that - a
    # coincidental 0.68-0.72 vocabulary overlap (e.g. a murder judgment's
    # witness testimony mentioning doors/incidents scoring close to "car
    # accident") isn't actually similar just because nothing else in the
    # firm scored better; it should surface no suggestion at all rather
    # than a misleading one.
    NOTEWORTHY_THRESHOLD = 0.65
    # A large document (hundreds of chunks) has many chances to land a
    # chunk that coincidentally shares vocabulary with the question
    # (e.g. a murder judgment's call-record analysis mentioning "phone"
    # scoring under a fixed threshold for "my phone was stolen") without
    # actually being about the same thing. Requiring every candidate to
    # also be close to the single best match - not just under a fixed
    # absolute bar - filters this out: a document only gets suggested if
    # it's genuinely in the same neighbourhood as the strongest hit, no
    # matter how many chunks a large document throws at the search.
    NOTEWORTHY_MARGIN = 0.10

    if not chunks or best_distance > NOTEWORTHY_THRESHOLD:
        return ""

    from api.models import UploadedDocument

    cutoff = min(NOTEWORTHY_THRESHOLD, best_distance + NOTEWORTHY_MARGIN)

    seen_doc_ids = []
    for chunk in chunks:
        if chunk.get("score") is None or chunk["score"] > cutoff:
            continue
        doc_id = chunk.get("metadata", {}).get("document_id")
        if doc_id and doc_id not in seen_doc_ids:
            seen_doc_ids.append(doc_id)

    if not seen_doc_ids:
        return ""

    names = list(
        UploadedDocument.objects.filter(document_id__in=seen_doc_ids).values_list(
            "original_name", flat=True
        )
    )
    if not names:
        return ""

    if len(names) == 1:
        return (
            f"I couldn't find a direct answer in your firm's documents, but there is "
            f'a similar case on file: "{names[0]}". Ask me to explain that case if '
            f"you'd like, or you're welcome to try a web search yourself for general "
            f"guidance."
        )

    quoted = ", ".join(f'"{name}"' for name in names)
    return (
        f"I couldn't find a direct answer in your firm's documents, but there are "
        f"{len(names)} similar cases on file: {quoted}. Ask me to explain any of them "
        f"if you'd like, or you're welcome to try a web search yourself for general "
        f"guidance."
    )


def _match_document_by_name(question: str, firm):
    """
    If the message names one of the firm's documents by filename (typed
    alone, or in a natural phrasing like "explain fir.pdf" or "summarize
    fir"), resolve it directly instead of running a loose semantic search
    that can grab chunks from a completely different document that merely
    shares vocabulary (e.g. asking about "fir.pdf" matching a judgment PDF
    that discusses FIRs at length, instead of the actual fir.pdf).
    Matches the filename (or its stem, min 3 chars) as a whole word so it
    doesn't misfire on unrelated substrings.
    """
    import re

    from api.models import UploadedDocument

    stripped = question.strip().lower()
    if not stripped or len(stripped) > 200:
        return None

    documents = list(UploadedDocument.objects.filter(firm=firm))

    # Prefer a match on the full filename (with extension) first.
    for doc in documents:
        name = doc.original_name.lower()
        if re.search(rf"\b{re.escape(name)}\b", stripped):
            return doc

    # Fall back to the filename's stem alone (e.g. "fir" for "fir.pdf").
    for doc in documents:
        stem = doc.original_name.lower().rsplit(".", 1)[0]
        if len(stem) >= 3 and re.search(rf"\b{re.escape(stem)}\b", stripped):
            return doc

    return None


def _summarize_named_document(document) -> Dict:
    from .document_intelligence import summarize_document

    text = _read_document_text(document)
    summary = summarize_document(text)

    return {
        "answer": summary,
        "sources": [
            {
                "source_type": "document",
                "document_id": str(document.document_id),
                "document_name": document.original_name,
                "document_source": document.source,
                # Not a semantic-search match - the whole named document was
                # read directly, so this is a certain match, not a guess.
                "confidence_percent": 100,
                "preview": text[:300],
            }
        ],
        "needs_web_confirmation": False,
    }


def _read_document_text(document) -> str:
    # Capped for the same reason as api/views.py's identically-named
    # helper: summarize_document() truncates to MAX_DOCUMENT_CHARS before
    # its LLM call anyway, so extracting the whole document first here
    # would be the same wasted, synchronous-in-the-request work that
    # caused a "socket hang up" on a large PDF elsewhere in this codebase.
    from .document_intelligence import MAX_DOCUMENT_CHARS

    return extract_text_from_document(
        file_path=document.file.path,
        document_type=document.document_type,
        max_chars=MAX_DOCUMENT_CHARS,
    )


def answer_general_question(
    question: str,
    firm,
    role: str = "lawyer",
    allow_web_search: bool = False,
    answer_mode: str = "mixed",
    history: Optional[List[Dict]] = None,
    region: str = "india",
    firm_only: bool = False,
) -> Dict:
    """
    Answers a question that isn't scoped to one specific uploaded document
    (no document_id picked). Tries, in order:
    1. Direct firm database stats (case/document/reminder counts etc.) -
       computed straight from the DB, never hallucinated by the LLM. Scoped
       to the caller's own firm either way, so this is safe for public
       users too (their own isolated pseudo-firm, never another firm's).
    2. If the message is essentially just naming one of the uploaded
       documents, summarize that document directly.
    3. Otherwise, search across every uploaded document (or, for General
       Public with no documents at all, there's nothing to search). If
       that fails, both roles ask for web-search consent before searching
       - unless the question itself already explicitly asked for a web
         search, which counts as consent already given - then fall back to
         LLM knowledge if the web search also finds nothing.
    """
    is_public = role == "public"

    # try_answer_firm_stats returns a 3-tuple (answer, resolved_case_id,
    # is_cases_query); only the answer text matters here (case-id tracking is
    # the view's job). Unpacking is required - the tuple itself is never None,
    # so testing the raw return would always short-circuit with a tuple as the
    # "answer".
    stats_answer, _resolved_case_id, _is_cases_query = try_answer_firm_stats(question, firm)

    if stats_answer is not None:
        return {
            "answer": stats_answer,
            "sources": [],
            "needs_web_confirmation": False,
            "route": ROUTE_FIRM_DATABASE,
            "confidence_level": CONFIDENCE_BY_ROUTE[ROUTE_FIRM_DATABASE],
        }

    named_document = _match_document_by_name(question, firm)

    if named_document is not None:
        try:
            result = _summarize_named_document(named_document)
            result["route"] = ROUTE_UPLOADED_DOCUMENT
            result["confidence_level"] = CONFIDENCE_BY_ROUTE[ROUTE_UPLOADED_DOCUMENT]
            return result
        except (FileNotFoundError, ValueError):
            pass  # fall through to normal search if the file can't be read

    explicit_web = _explicit_web_intent(question)

    from api.models import UploadedDocument

    if is_public and not UploadedDocument.objects.filter(firm=firm).exists():
        # General Public, no documents uploaded at all: nothing local to
        # search. In Firm Search mode that's the end of the road - no web /
        # general-knowledge fallback.
        if firm_only:
            return firm_not_found_result()

        # ask before searching the web (unless already explicitly
        # requested/confirmed).
        if explicit_web or allow_web_search:
            web_results = search_legal_web(question, region=region)
            if web_results:
                return _web_search_result(
                    question, web_results, answer_mode, history, region,
                    context_label="a document",
                )
            return _llm_knowledge_result(question, answer_mode, history, disclaimer_no_web_results(region))

        return _ask_web_consent(question, [], float("inf"), answer_mode, history)

    chunks = retrieve_firm_context(question=question, firm_id=firm.id, top_k=5)

    threshold = settings.RAG_RELEVANCE_DISTANCE_THRESHOLD
    best_distance = _best_distance(chunks)
    local_match_found = bool(chunks) and best_distance <= threshold

    if local_match_found:
        context = build_context(chunks)
        context_label = "Your uploaded documents" if is_public else "Your firm's documents"
        answer = generate_legal_answer(
            question=question,
            context=context,
            mode=answer_mode,
            context_label=context_label,
            history=history,
        )
        # A chunk can pass the distance threshold without actually
        # answering the question - trust the model's own admission over
        # the embedding-distance heuristic and fall through instead.
        if not is_insufficient_answer(answer):
            route = ROUTE_UPLOADED_DOCUMENT if is_public else ROUTE_FIRM_DATABASE
            return {
                "answer": answer,
                "sources": _build_document_sources(chunks),
                "needs_web_confirmation": False,
                "route": route,
                "confidence_level": CONFIDENCE_BY_ROUTE[route],
            }

    # Firm Search mode: the firm's documents had nothing relevant, and this
    # mode never falls back to the web or the model's general knowledge.
    if firm_only:
        return firm_not_found_result()

    if is_public:
        if explicit_web or allow_web_search:
            web_results = search_legal_web(question, region=region)
            if web_results:
                return _web_search_result(
                    question, web_results, answer_mode, history, region,
                    context_label="your uploaded documents",
                )
            return _llm_knowledge_result(question, answer_mode, history, disclaimer_no_web_results(region))

        return _ask_web_consent(question, chunks, best_distance, answer_mode, history)

    # Lawyer, no document selected: an explicit request in the question
    # counts as consent already given; otherwise ask before searching the
    # web, same as every other "nothing found locally" branch.
    if explicit_web or allow_web_search:
        web_results = search_legal_web(question, region=region)
        if web_results:
            return _web_search_result(
                question, web_results, answer_mode, history, region,
                context_label="the firm's documents",
            )
        return _llm_knowledge_result(question, answer_mode, history, disclaimer_no_firm_or_web(region))

    return _ask_web_consent(question, chunks, best_distance, answer_mode, history)
