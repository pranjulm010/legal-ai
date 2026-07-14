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


class AskQuestionSchema(Schema):
    question: str
    document_id: Optional[str] = None
    case_id: Optional[int] = None
    user_id: str = "anonymous"
    session_id: str = "default-session"
    user_type: str = "public"
    answer_mode: str = "plain_english"
    document_type: Optional[str] = None
    allow_web_search: bool = False
    use_agent: bool = False
    use_advanced_agent: bool = True
    chat_session_id: Optional[int] = None
    region: Optional[str] = None


class ResearchStepSchema(Schema):
    sub_question: str
    source_type: str
    resolved: bool


class AskQuestionResponseSchema(Schema):
    question: str
    answer: str
    sources: List[Any]
    chat_id: Optional[int] = None
    chat_session_id: Optional[int] = None
    needs_web_confirmation: bool = False
    research_steps: Optional[List[ResearchStepSchema]] = None
    route: Optional[str] = None
    confidence_level: Optional[str] = None


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


