"""
Knowledge Base ingestion: extract -> chunk -> embed uploaded documents into
the firm's Chroma collection. Question answering lives entirely in the
chat pipeline (backend/chat/) - retrieval is exposed to it through the
search_documents tool.
"""
from .chunking import chunk_text
from .document_processor import extract_text_from_document
from .vector_store import store_document_chunks


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
