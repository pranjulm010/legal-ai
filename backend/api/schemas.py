from typing import List, Optional, Any
from datetime import datetime

from ninja import Schema


class ErrorResponseSchema(Schema):
    error: str
    details: Optional[str] = None
    supported_types: Optional[List[str]] = None
    note: Optional[str] = None


class UploadDocumentResponseSchema(Schema):
    message: str
    document_id: str
    file_name: str
    document_type: str
    total_chunks: int
    status: str = "ready"


class DocumentStatusSchema(Schema):
    document_id: str
    status: str
    total_chunks: int
    error_message: str = ""


class DocumentListItemSchema(Schema):
    document_id: str
    file_name: str
    document_type: str
    tags: str
    case_id: Optional[int] = None
    case_title: Optional[str] = None
    uploaded_at: datetime
    source: str
    status: str = "ready"
    version_number: int = 1


class DocumentVersionItemSchema(Schema):
    document_id: str
    file_name: str
    version_number: int
    uploaded_at: datetime
    status: str
    is_current: bool


class DocumentTagsUpdateSchema(Schema):
    tags: str


class DocumentRenameSchema(Schema):
    file_name: str


class DocumentContentSchema(Schema):
    """The document's current editable text and whether it has been edited
    in-app (vs. still reflecting the original uploaded file)."""

    document_id: str
    file_name: str
    document_type: str
    content: str
    edited: bool


class DocumentContentUpdateSchema(Schema):
    content: str


class ChatMessageSchema(Schema):
    id: int
    question: str
    answer: str
    created_at: datetime


class ChatHistoryResponseSchema(Schema):
    document_id: str
    file_name: str
    document_type: str
    chats: List[ChatMessageSchema]


class ChatSearchResultSchema(Schema):
    id: int
    question: str
    answer: str
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    chat_session_id: Optional[int] = None
    created_at: datetime


class ChatSearchResponseSchema(Schema):
    results: List[ChatSearchResultSchema]


class ChatSessionMessageSchema(Schema):
    id: int
    question: str
    answer: str
    created_at: datetime
    route: str = ""
    sources: List[dict] = []
    # The requesting user's own thumbs rating ("up"/"down"), if any.
    my_feedback: Optional[str] = None


class ChatSessionDetailSchema(Schema):
    id: int
    title: str
    document_id: Optional[str] = None
    document_name: Optional[str] = None
    messages: List[ChatSessionMessageSchema]


class ChatSessionListItemSchema(Schema):
    id: int
    title: str
    message_count: int
    last_question: Optional[str] = None
    updated_at: datetime


class ChatSessionRenameSchema(Schema):
    title: str


class DocumentSummarySchema(Schema):
    summary: str


class EntityExtractionSchema(Schema):
    dates: List[str] = []
    parties: List[str] = []
    case_number: Optional[str] = None
    court_name: Optional[str] = None
    sections_referenced: List[str] = []
    amounts: List[str] = []
    addresses: List[str] = []


class RiskItemSchema(Schema):
    clause_excerpt: str
    risk: str
    severity: str


class RiskAnalysisSchema(Schema):
    risks: List[RiskItemSchema]


class ComplianceFindingSchema(Schema):
    item: str
    status: str
    note: str


class ComplianceCheckSchema(Schema):
    findings: List[ComplianceFindingSchema]


class CompareDocumentsSchema(Schema):
    document_id_a: str
    document_id_b: str


class CompareResultSchema(Schema):
    comparison: str


