from django.http import StreamingHttpResponse
from django.shortcuts import get_object_or_404
from ninja import Router

from accounts.auth import JWTAuth
from api.models import ChatMessage

from .models import MessageFeedback
from .orchestrator import stream_chat_turn
from .schemas import ChatStreamRequest, ErrorSchema, FeedbackRequest, FeedbackResponse

chat_router = Router(auth=JWTAuth())


@chat_router.post("/stream/")
def chat_stream(request, payload: ChatStreamRequest):
    """
    One conversation turn as a Server-Sent Events stream:
    session -> status/tool_call/tool_result -> token* -> message -> done
    (or error -> done). Returned directly as a StreamingHttpResponse so
    each event flushes as it happens.
    """
    response = StreamingHttpResponse(
        stream_chat_turn(request.auth, payload),
        content_type="text/event-stream",
    )
    response["Cache-Control"] = "no-cache"
    # Tells buffering proxies (nginx & friends) to pass events through.
    response["X-Accel-Buffering"] = "no"
    return response


def _get_firm_message(request, chat_id: int) -> ChatMessage:
    return get_object_or_404(
        ChatMessage, id=chat_id, firm=request.auth.firm
    )


@chat_router.post(
    "/messages/{chat_id}/feedback/",
    response={200: FeedbackResponse, 404: ErrorSchema},
)
def submit_feedback(request, chat_id: int, payload: FeedbackRequest):
    message = _get_firm_message(request, chat_id)

    feedback, _ = MessageFeedback.objects.update_or_create(
        message=message,
        user=request.auth,
        defaults={
            "firm": request.auth.firm,
            "rating": payload.rating,
            "comment": payload.comment,
        },
    )

    if payload.rating == "down":
        # A thumbs-down is a learning signal: distill it into the user's
        # memory so future answers adapt. Import lazily - the memory layer
        # pulls in the embedding model, which feedback submission shouldn't
        # load unless needed.
        from .memory.writer import record_feedback_memory

        record_feedback_memory(request.auth, message, payload.comment)

    return 200, FeedbackResponse(
        message_id=message.id, rating=feedback.rating, comment=feedback.comment
    )


@chat_router.delete(
    "/messages/{chat_id}/feedback/",
    response={200: dict, 404: ErrorSchema},
)
def clear_feedback(request, chat_id: int):
    message = _get_firm_message(request, chat_id)
    MessageFeedback.objects.filter(message=message, user=request.auth).delete()
    return 200, {"ok": True}
