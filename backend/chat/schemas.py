from typing import Literal, Optional

from ninja import Schema


class ErrorSchema(Schema):
    error: str


class ChatStreamRequest(Schema):
    question: str
    chat_session_id: Optional[int] = None
    document_id: Optional[str] = None
    case_id: Optional[int] = None
    # Jurisdiction for web search; falls back to the firm's default region.
    region: Optional[str] = None


class FeedbackRequest(Schema):
    rating: Literal["up", "down"]
    comment: str = ""


class FeedbackResponse(Schema):
    message_id: int
    rating: str
    comment: str
