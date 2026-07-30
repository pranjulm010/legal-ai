from rag.document_intelligence import compare_documents as _compare_documents_text
from rag.document_processor import extract_text_from_document

from .registry import ToolContext, ToolResult, result_json, tool


@tool(
    name="compare_documents",
    description="Compare two of the firm's uploaded documents and summarize the differences.",
    parameters={
        "type": "object",
        "properties": {
            "document_id_a": {"type": "string"},
            "document_id_b": {"type": "string"},
        },
        "required": ["document_id_a", "document_id_b"],
    },
)
def compare_documents(ctx: ToolContext, document_id_a: str, document_id_b: str) -> ToolResult:
    from api.models import UploadedDocument

    try:
        doc_a = UploadedDocument.objects.get(document_id=document_id_a)
        doc_b = UploadedDocument.objects.get(document_id=document_id_b)
    except (UploadedDocument.DoesNotExist, ValueError):
        return ToolResult(content='{"error": "One or both documents were not found."}')

    if doc_a.firm_id != ctx.firm.id or doc_b.firm_id != ctx.firm.id:
        return ToolResult(content='{"error": "You do not have access to one of these documents."}')

    text_a = extract_text_from_document(file_path=doc_a.file.path, document_type=doc_a.document_type)
    text_b = extract_text_from_document(file_path=doc_b.file.path, document_type=doc_b.document_type)

    comparison = _compare_documents_text(text_a, doc_a.original_name, text_b, doc_b.original_name)

    return ToolResult(
        content=result_json({"comparison": comparison}),
        sources=[
            {"source_type": "compare", "document_id": document_id_a, "document_name": doc_a.original_name},
            {"source_type": "compare", "document_id": document_id_b, "document_name": doc_b.original_name},
        ],
    )
