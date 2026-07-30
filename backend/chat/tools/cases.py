"""
Case tools: semantic similar-case search, full case detail retrieval, and
in-app deep links to case pages. All firm-scoped.
"""
from typing import Dict, List, Optional

from rag.embeddings import embed_text, embed_texts
from rag.vector_store import get_chroma_client

from .registry import ToolContext, ToolResult, result_json, tool


def _case_index(firm_id: int):
    return get_chroma_client().get_or_create_collection(
        name=f"case_index_firm_{firm_id}",
        metadata={"hnsw:space": "cosine"},
    )


def _case_embedding_text(case) -> str:
    return " | ".join(
        part
        for part in (case.title, case.case_type, case.client_name, case.description[:500])
        if part
    )


def _sync_case_index(firm) -> None:
    """
    Lazily reconcile the firm's case index with the database at query time
    (upsert changed cases by updated_at, drop deleted ones) - keeps the
    cases app free of chatbot signals/hooks.
    """
    from cases.models import Case

    collection = _case_index(firm.id)
    indexed = collection.get(include=["metadatas"])
    indexed_stamp = {
        chroma_id: (meta or {}).get("updated_at")
        for chroma_id, meta in zip(indexed["ids"], indexed["metadatas"])
    }

    cases = list(Case.objects.filter(firm=firm))
    live_ids = {f"case_{case.id}" for case in cases}

    stale_ids = [chroma_id for chroma_id in indexed_stamp if chroma_id not in live_ids]
    if stale_ids:
        collection.delete(ids=stale_ids)

    to_upsert = [
        case
        for case in cases
        if indexed_stamp.get(f"case_{case.id}") != case.updated_at.isoformat()
    ]
    if to_upsert:
        collection.upsert(
            ids=[f"case_{case.id}" for case in to_upsert],
            embeddings=embed_texts([_case_embedding_text(case) for case in to_upsert]),
            documents=[_case_embedding_text(case) for case in to_upsert],
            metadatas=[
                {
                    "case_id": case.id,
                    "firm_id": firm.id,
                    "updated_at": case.updated_at.isoformat(),
                }
                for case in to_upsert
            ],
        )


def _case_summary(case) -> Dict:
    return {
        "case_id": case.id,
        "title": case.title,
        "case_type": case.case_type,
        "status": case.status,
        "client_name": case.client_name,
        "description": (case.description or "")[:300],
    }


@tool(
    name="similar_case_search",
    description=(
        "Find the firm's own cases most similar to a description, topic, or "
        "an existing matter (semantic search over case titles, types, "
        "clients, and descriptions, plus exact name matches). Use when the "
        "user asks about similar/related/comparable cases or whether the "
        "firm has handled something like this before."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Description of the matter to find similar cases for.",
            },
            "top_k": {"type": "integer", "description": "How many cases to return (default 5)."},
        },
        "required": ["query"],
    },
)
def similar_case_search(ctx: ToolContext, query: str, top_k: int = 5) -> ToolResult:
    from django.db.models import Q

    from cases.models import Case

    top_k = max(1, min(int(top_k), 10))
    _sync_case_index(ctx.firm)

    collection = _case_index(ctx.firm.id)
    matches: List[Dict] = []
    seen_ids = set()

    if collection.count() > 0:
        result = collection.query(
            query_embeddings=[embed_text(query)],
            n_results=min(top_k, collection.count()),
            include=["metadatas", "distances"],
        )
        case_ids = [meta["case_id"] for meta in result["metadatas"][0]]
        distances = result["distances"][0]
        cases_by_id = {case.id: case for case in Case.objects.filter(firm=ctx.firm, id__in=case_ids)}
        for case_id, distance in zip(case_ids, distances):
            case = cases_by_id.get(case_id)
            if case is None:
                continue
            matches.append({**_case_summary(case), "similarity_distance": round(distance, 3)})
            seen_ids.add(case_id)

    # Exact keyword union - a literal title/client match must never be
    # missed just because its embedding ranks low.
    keyword_cases = Case.objects.filter(firm=ctx.firm).filter(
        Q(title__icontains=query) | Q(client_name__icontains=query) | Q(description__icontains=query)
    )[:top_k]
    for case in keyword_cases:
        if case.id not in seen_ids:
            matches.append({**_case_summary(case), "matched_on": "exact_text"})
            seen_ids.add(case.id)

    if not matches:
        return ToolResult(content=result_json({"found": False, "cases": []}))

    matches = matches[:top_k]
    sources = [
        {"source_type": "case", "case_id": match["case_id"], "case_title": match["title"]}
        for match in matches
    ]
    return ToolResult(
        content=result_json({"found": True, "cases": matches}),
        sources=sources,
        meta={"case_ids": [match["case_id"] for match in matches]},
    )


@tool(
    name="get_case_details",
    description=(
        "Look up full details of one of the firm's cases: status, client, "
        "description, assigned lawyers, reminders, contacts, linked "
        "documents, and drafts. Pass case_id if known (e.g. from the active "
        "case or a similar_case_search result); otherwise pass title with "
        "the name the user used."
    ),
    parameters={
        "type": "object",
        "properties": {
            "case_id": {"type": "integer", "description": "The case's numeric ID, if known."},
            "title": {"type": "string", "description": "The case's name/title, if the ID isn't known."},
        },
    },
)
def get_case_details(ctx: ToolContext, case_id: Optional[int] = None, title: Optional[str] = None) -> ToolResult:
    from cases.models import Case, Contact
    from drafts.models import Draft

    if case_id:
        try:
            case = Case.objects.prefetch_related(
                "assigned_lawyers__user", "reminders", "documents"
            ).get(id=case_id, firm=ctx.firm)
        except Case.DoesNotExist:
            return ToolResult(content=result_json({"error": "Case not found."}))
    elif title:
        matches = list(
            Case.objects.prefetch_related("assigned_lawyers__user", "reminders", "documents")
            .filter(firm=ctx.firm, title__icontains=title.strip())[:6]
        )
        if not matches:
            return ToolResult(
                content=result_json({"error": f'No case found matching the name "{title}".'})
            )
        if len(matches) > 1:
            return ToolResult(
                content=result_json(
                    {
                        "error": "Multiple cases match that name - ask the user which one they mean.",
                        "matches": [{"case_id": c.id, "title": c.title} for c in matches],
                    }
                )
            )
        case = matches[0]
    else:
        return ToolResult(content=result_json({"error": "No case_id or title given to look up."}))

    payload = {
        "case_id": case.id,
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
            for contact in Contact.objects.filter(case=case, firm=ctx.firm)
        ],
        "documents": [
            {"document_id": str(doc.document_id), "file_name": doc.original_name}
            for doc in case.documents.all()
        ],
        "drafts": [
            {"draft_id": draft.id, "title": draft.title, "draft_type": draft.draft_type}
            for draft in Draft.objects.filter(case=case, firm=ctx.firm)
        ],
    }
    return ToolResult(
        content=result_json(payload),
        sources=[{"source_type": "case", "case_id": case.id, "case_title": case.title}],
        meta={"case_ids": [case.id]},
    )


@tool(
    name="get_case_link",
    description=(
        "Get the in-app link to a case's detail page so the user can open "
        "it directly. Use when the user asks to open, go to, or be taken to "
        "a case. Include the returned link in your answer as a markdown "
        "link."
    ),
    parameters={
        "type": "object",
        "properties": {
            "case_id": {"type": "integer", "description": "The case's numeric ID."},
        },
        "required": ["case_id"],
    },
)
def get_case_link(ctx: ToolContext, case_id: int) -> ToolResult:
    from cases.models import Case

    try:
        case = Case.objects.get(id=case_id, firm=ctx.firm)
    except Case.DoesNotExist:
        return ToolResult(content=result_json({"error": "Case not found."}))

    link = f"/cases/{case.id}"
    return ToolResult(
        content=result_json(
            {
                "case_id": case.id,
                "title": case.title,
                "link": link,
                "note": f"Render as a markdown link, e.g. [{case.title}]({link}).",
            }
        ),
        sources=[
            {
                "source_type": "case_link",
                "case_id": case.id,
                "case_title": case.title,
                "url": link,
            }
        ],
        meta={"link": link, "case_ids": [case.id]},
    )
