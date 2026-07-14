from typing import List, Dict
from .vector_store import search_firm_chunks, search_similar_chunks


def retrieve_context(
    question: str,
    document_id: str,
    firm_id: int,
    top_k: int = 5
) -> List[Dict]:
    """
    Retrieve most relevant chunks from the firm's own vector database.
    """

    return search_similar_chunks(
        question=question,
        document_id=document_id,
        firm_id=firm_id,
        top_k=top_k
    )


def retrieve_firm_context(
    question: str,
    firm_id: int,
    top_k: int = 5
) -> List[Dict]:
    """
    Retrieve most relevant chunks across all of the firm's documents -
    for questions not scoped to one specific upload.
    """

    return search_firm_chunks(
        question=question,
        firm_id=firm_id,
        top_k=top_k
    )
