from typing import List, Dict
from django.conf import settings
import chromadb

from .embeddings import embed_text, embed_texts


def get_chroma_client():
    """
    Create persistent ChromaDB client.
    Data will be stored inside vector_db folder.
    """

    return chromadb.PersistentClient(path=str(settings.VECTOR_DB_DIR))


def get_collection(firm_id: int):
    """
    Each firm gets its own isolated Chroma collection. This is a hard
    structural boundary, not just a metadata filter - a query against
    Firm A's collection can never return Firm B's vectors even if a
    `where` filter is accidentally omitted elsewhere.
    """

    client = get_chroma_client()

    return client.get_or_create_collection(
        name=f"legal_documents_firm_{firm_id}",
        metadata={"hnsw:space": "cosine"},
    )


def store_document_chunks(
    document_id: str,
    chunks: List[Dict],
    firm_id: int,
) -> int:
    """
    Store chunks and embeddings in the firm's own ChromaDB collection.
    """

    if not chunks:
        return 0

    collection = get_collection(firm_id)

    ids = []
    texts = []
    metadatas = []

    for chunk in chunks:
        chunk_unique_id = f"{document_id}_{chunk['chunk_id']}"

        ids.append(chunk_unique_id)
        texts.append(chunk["text"])
        metadatas.append({
            "document_id": document_id,
            "chunk_id": chunk["chunk_id"],
            # 0 means "no page info" (e.g. .txt/.docx have no page concept) -
            # Chroma metadata values can't be None, so 0 is the sentinel.
            "page_number": chunk.get("page_number") or 0,
        })

    embeddings = embed_texts(texts)

    collection.add(
        ids=ids,
        documents=texts,
        embeddings=embeddings,
        metadatas=metadatas,
    )

    return len(chunks)


def delete_document_chunks(document_id: str, firm_id: int) -> None:
    """
    Removes a document's chunks from its firm's collection. Safe to call
    even if the document has no stored chunks (e.g. processing failed).
    """

    collection = get_collection(firm_id)
    collection.delete(where={"document_id": document_id})


def search_similar_chunks(
    question: str,
    document_id: str,
    firm_id: int,
    top_k: int = 5
) -> List[Dict]:
    """
    Search relevant chunks only from the selected document, scoped to
    the firm's own isolated collection.
    """

    collection = get_collection(firm_id)

    question_embedding = embed_text(question)

    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=top_k,
        where={"document_id": document_id},
    )

    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    final_results = []

    for text, metadata, distance in zip(documents, metadatas, distances):
        final_results.append({
            "text": text,
            "metadata": metadata,
            "score": distance,
        })

    return final_results


def keyword_search_chunks(
    keyword: str,
    firm_id: int,
    document_id: str = None,
    top_k: int = 5,
) -> List[Dict]:
    """
    Exact-substring match via Chroma's where_document $contains filter -
    catches specific terms (a section number, a name, a docket ID) that
    semantic vector similarity alone can miss or under-rank. This is
    additive: search_similar_chunks/search_firm_chunks above (used by the
    tuned deterministic RAG pipeline) are untouched - this is a new,
    separate function used only where a caller explicitly wants a hybrid
    search (see agent_tools.py). No native relevance score exists for a
    literal substring match, so results get a synthetic best-possible
    score of 0.0 - a real string match is a strong signal in its own
    right, distinct from vector distance.
    """
    collection = get_collection(firm_id)
    where = {"document_id": document_id} if document_id else None

    try:
        results = collection.get(
            where=where,
            where_document={"$contains": keyword},
            limit=top_k,
        )
    except Exception:
        return []

    documents = results.get("documents") or []
    metadatas = results.get("metadatas") or []

    return [
        {"text": text, "metadata": metadata, "score": 0.0}
        for text, metadata in zip(documents, metadatas)
    ]


def search_firm_chunks(
    question: str,
    firm_id: int,
    top_k: int = 5
) -> List[Dict]:
    """
    Search across every document in the firm's collection (no single
    document_id filter) - used for general questions that aren't scoped
    to one specific upload, e.g. "what is Article 35". Still hard-scoped
    to the firm's own isolated collection, same as search_similar_chunks.
    """

    collection = get_collection(firm_id)

    question_embedding = embed_text(question)

    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=top_k,
    )

    documents = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    final_results = []

    for text, metadata, distance in zip(documents, metadatas, distances):
        final_results.append({
            "text": text,
            "metadata": metadata,
            "score": distance,
        })

    return final_results
