"""
Memory RAG vector store: one Chroma collection per (firm, user). The SQL
MemoryEntry rows are the source of truth; these collections are a
rebuildable retrieval index keyed by row PK ("mem_{id}"). Firm id in the
collection name plus firm/user metadata is a double tenancy guard -
memory is personal, never firm-wide.
"""
from typing import List, Optional

from rag.embeddings import embed_text
from rag.vector_store import get_chroma_client


def get_memory_collection(firm_id: int, user_id: int):
    return get_chroma_client().get_or_create_collection(
        name=f"user_memory_firm_{firm_id}_user_{user_id}",
        metadata={"hnsw:space": "cosine"},
    )


def upsert_memory_vector(entry) -> None:
    collection = get_memory_collection(entry.firm_id, entry.user_id)
    collection.upsert(
        ids=[f"mem_{entry.id}"],
        embeddings=[embed_text(entry.content)],
        documents=[entry.content],
        metadatas=[
            {
                "entry_id": entry.id,
                "firm_id": entry.firm_id,
                "user_id": entry.user_id,
                "kind": entry.kind,
            }
        ],
    )


def delete_memory_vector(entry) -> None:
    collection = get_memory_collection(entry.firm_id, entry.user_id)
    collection.delete(ids=[f"mem_{entry.id}"])


def retrieve_memories(user, query_embedding: List[float], top_k: int = 5) -> List:
    """
    The MemoryEntry rows most relevant to the current question, verified
    against SQL so deactivated/deleted memories never resurface from a
    stale vector.
    """
    from chat.models import MemoryEntry

    collection = get_memory_collection(user.firm_id, user.id)
    if collection.count() == 0:
        return []

    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, collection.count()),
        include=["metadatas"],
    )
    entry_ids = [meta["entry_id"] for meta in result["metadatas"][0]]

    entries_by_id = {
        entry.id: entry
        for entry in MemoryEntry.objects.filter(
            id__in=entry_ids, user=user, is_active=True
        )
    }
    return [entries_by_id[entry_id] for entry_id in entry_ids if entry_id in entries_by_id]
