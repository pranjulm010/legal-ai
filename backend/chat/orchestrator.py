"""
The chat pipeline orchestrator.

One turn = validate -> resolve session -> retrieve memory -> detect intent
-> (tool loop) -> generate answer -> persist -> learn. The pipeline emits
typed events; stream_chat_turn encodes them as SSE bytes for the HTTP
endpoint, run_chat_turn_sync drains them for tests/evals.
"""
import json
import re
import time
from typing import Dict, Generator, List, Optional, Tuple

import groq
import openai

from rag.embeddings import embed_text
from rag.groq_client import get_groq_client, get_groq_model
from rag.llm_override import set_request_firm

from .intent import detect_intent
from .memory.profile import get_style_profile
from .memory.store import retrieve_memories
from .memory.writer import extract_and_store_async, record_correction_memory
from .prompts.fragments import wrap_untrusted_content
from .prompts.system import build_system_prompt
from .streaming import sse
from .tools import ToolContext, dispatch, groq_schemas

MAX_TOOL_TURNS = 4
HISTORY_TURNS = 8
HISTORY_ANSWER_CHARS = 1200
TOOL_RESULT_MAX_CHARS = 6000
MEMORY_TOP_K = 5
# Tools whose results resolve "which case is this conversation about".
_CASE_TOOLS = {"similar_case_search", "get_case_details", "get_case_link"}

# Icon grouping for the frontend's research-steps panel.
_STEP_SOURCE_TYPE = {
    "search_documents": "document",
    "search_web": "web",
    "similar_case_search": "case",
    "get_case_details": "case",
    "get_case_link": "case",
    "get_firm_overview": "case",
    "get_form_details": "case",
    "generate_draft": "draft",
    "compare_documents": "compare",
}

_TOO_LONG_MESSAGE = (
    "This conversation has grown too long for me to process in a single "
    "request. Please start a new chat (or ask your question more briefly) "
    "and I'll be able to answer it."
)
_PROVIDER_BUSY_MESSAGE = (
    "The AI service has hit its usage limit for the moment. Please wait a "
    "little while and try again - this clears on its own shortly."
)
_GENERIC_ERROR_MESSAGE = (
    "Something went wrong while generating the answer. Please try again in a moment."
)


class _TurnError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


# Provider 429s are transient (per-minute token budgets) and usually carry a
# "try again in Ns" hint - waiting it out once or twice turns a dead turn
# into a slightly slower one. Anything longer than the cap is surfaced to
# the user instead of silently hanging the stream.
_RETRY_AFTER_RE = re.compile(r"try again in (\d+(?:\.\d+)?)s", re.I)
_MAX_429_RETRIES = 2
_MAX_429_WAIT_SECONDS = 30.0

# Groq's native SDK raises its own exception class. The OpenAI provider
# path uses openai's SDK directly, and litellm (anthropic/gemini) maps its
# errors onto openai's exception hierarchy by design - so catching both
# covers every provider this pipeline can route through.
_PROVIDER_STATUS_ERRORS = (groq.APIStatusError, openai.APIStatusError)


def _completion_with_retry(client, **kwargs):
    for attempt in range(_MAX_429_RETRIES + 1):
        try:
            return client.chat.completions.create(**kwargs)
        except _PROVIDER_STATUS_ERRORS as error:
            if getattr(error, "status_code", None) != 429 or attempt == _MAX_429_RETRIES:
                raise
            match = _RETRY_AFTER_RE.search(str(error))
            wait = min(float(match.group(1)) + 1.0 if match else 10.0, _MAX_429_WAIT_SECONDS)
            time.sleep(wait)


def _describe_tool_call(name: str, arguments: Dict) -> str:
    detail = ""
    for value in arguments.values():
        if isinstance(value, str) and value.strip():
            detail = value.strip()[:120]
            break
        if isinstance(value, int):
            detail = str(value)
            break
    return f"{name}({detail})" if detail else name


def _load_history(session) -> List[Dict[str, str]]:
    if session is None:
        return []
    prior = list(session.messages.order_by("created_at").values("question", "answer"))
    recent = prior[-HISTORY_TURNS:]
    return [
        {
            "question": (turn["question"] or ""),
            "answer": (
                (turn["answer"][:HISTORY_ANSWER_CHARS] + " …")
                if turn["answer"] and len(turn["answer"]) > HISTORY_ANSWER_CHARS
                else (turn["answer"] or "")
            ),
        }
        for turn in recent
    ]


def _history_messages(history: List[Dict[str, str]]) -> List[Dict]:
    messages = []
    for turn in history:
        messages.append({"role": "user", "content": turn["question"]})
        messages.append({"role": "assistant", "content": turn["answer"]})
    return messages


def _chunk_text(text: str, size: int = 80):
    for start in range(0, len(text), size):
        yield text[start : start + size]


def _resolve_document(user, document_id: Optional[str]):
    from api.models import UploadedDocument

    if not document_id:
        return None
    try:
        document = UploadedDocument.objects.get(document_id=document_id)
    except (UploadedDocument.DoesNotExist, ValueError):
        raise _TurnError("Document not found.")
    if document.firm_id != user.firm_id:
        raise _TurnError("You do not have access to this document.")
    if document.status == "processing":
        raise _TurnError(
            "This document is still being processed. Please wait a moment and try again."
        )
    if document.status == "failed":
        raise _TurnError("This document failed to process and can't be searched.")
    return document


def _resolve_session(user, chat_session_id: Optional[int], question: str, document):
    from api.models import ChatSession

    if chat_session_id:
        try:
            return ChatSession.objects.get(id=chat_session_id, firm=user.firm), False
        except ChatSession.DoesNotExist:
            raise _TurnError("Chat session not found.")

    session = ChatSession.objects.create(
        firm=user.firm,
        started_by=user,
        title=question.strip()[:255],
        document=document,
    )
    return session, True


def chat_turn_events(
    user,
    question: str,
    chat_session_id: Optional[int] = None,
    document_id: Optional[str] = None,
    case_id: Optional[int] = None,
    region: Optional[str] = None,
) -> Generator[Tuple[str, Dict], None, None]:
    """Yields (event, data) tuples for one chat turn."""
    from api.models import ChatMessage

    question = (question or "").strip()
    session = None

    try:
        if not question:
            raise _TurnError("Question is required.")

        # Per-firm LLM key/model override for every call in this turn.
        set_request_firm(user.firm_id)

        document = _resolve_document(user, document_id)
        session, created = _resolve_session(user, chat_session_id, question, document)
        if document is None and session.document is not None:
            document = session.document
        yield "session", {"chat_session_id": session.id, "title": session.title}

        active_case_id = case_id or session.active_case_id
        history = _load_history(session)

        # Memory RAG: what do we know about this user, relevant to this turn?
        yield "status", {"stage": "memory", "label": "Recalling your preferences"}
        intent = detect_intent(
            question,
            history,
            has_document=document is not None,
            has_case=active_case_id is not None,
        )
        if intent.is_correction and intent.correction_summary:
            # Stored synchronously so the correction shapes this very answer.
            record_correction_memory(user, user.firm, intent.correction_summary)

        question_embedding = embed_text(question)
        memories = retrieve_memories(user, question_embedding, top_k=MEMORY_TOP_K)
        style_summary = get_style_profile(user)

        active_case_title = None
        if active_case_id:
            from cases.models import Case

            active_case_title = (
                Case.objects.filter(id=active_case_id, firm=user.firm)
                .values_list("title", flat=True)
                .first()
            )

        use_tools = intent.route == "tools"
        system_prompt = build_system_prompt(
            firm=user.firm,
            user=user,
            style_summary=style_summary,
            memories=memories,
            document=document,
            active_case_title=active_case_title,
            tools_enabled=use_tools,
        )
        messages: List[Dict] = [{"role": "system", "content": system_prompt}]
        messages += _history_messages(history)
        messages.append({"role": "user", "content": question})

        client = get_groq_client()
        model = get_groq_model()
        sources: List[Dict] = []
        research_steps: List[Dict] = []
        answer = ""
        case_tool_ran = False
        resolved_case_ids: set = set()

        if use_tools:
            ctx = ToolContext(
                user=user,
                firm=user.firm,
                session=session,
                document=document,
                case_id=active_case_id,
                region=region or getattr(user.firm, "default_region", "") or "india",
            )
            schemas = groq_schemas(user)

            for _ in range(MAX_TOOL_TURNS):
                yield "status", {"stage": "thinking", "label": "Working out what to look up"}
                response = _completion_with_retry(
                    client,
                    model=model,
                    messages=messages,
                    tools=schemas,
                    tool_choice="auto",
                    temperature=0.2,
                )
                choice = response.choices[0].message

                if not choice.tool_calls:
                    answer = choice.content or ""
                    break

                messages.append(
                    {
                        "role": "assistant",
                        "content": choice.content or "",
                        "tool_calls": [
                            {
                                "id": tool_call.id,
                                "type": "function",
                                "function": {
                                    "name": tool_call.function.name,
                                    "arguments": tool_call.function.arguments,
                                },
                            }
                            for tool_call in choice.tool_calls
                        ],
                    }
                )

                for tool_call in choice.tool_calls:
                    name = tool_call.function.name
                    try:
                        arguments = json.loads(tool_call.function.arguments or "{}")
                    except (TypeError, ValueError):
                        arguments = {}
                    # The model can emit "null" or a bare string here.
                    if not isinstance(arguments, dict):
                        arguments = {}

                    yield "tool_call", {"id": tool_call.id, "name": name, "arguments": arguments}
                    result = dispatch(name, arguments, ctx)

                    sources.extend(result.sources)
                    summary = _describe_tool_call(name, arguments)
                    research_steps.append(
                        {
                            "tool": name,
                            "sub_question": summary,
                            "source_type": _STEP_SOURCE_TYPE.get(name, "context"),
                            "resolved": True,
                        }
                    )
                    if name in _CASE_TOOLS:
                        case_tool_ran = True
                        resolved_case_ids.update(result.meta.get("case_ids") or [])

                    # Tool output can embed uploaded-document/web text -
                    # untrusted content, delimited so the model treats it as
                    # data (see fragments.INJECTION_DEFENSE_INSTRUCTION).
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": tool_call.id,
                            "content": wrap_untrusted_content(
                                result.content[:TOOL_RESULT_MAX_CHARS]
                            ),
                        }
                    )
                    yield "tool_result", {
                        "id": tool_call.id,
                        "name": name,
                        "summary": summary,
                        "sources": result.sources,
                    }

            if not answer:
                # Tool budget exhausted - force a final grounded answer from
                # what was gathered, streamed for real.
                messages.append(
                    {
                        "role": "user",
                        "content": (
                            "Stop looking things up. Give your best final answer "
                            "from what you have found so far, and be explicit "
                            "about anything you could not verify."
                        ),
                    }
                )
                yield "status", {"stage": "generating", "label": "Writing the answer"}
                stream = _completion_with_retry(
                    client, model=model, messages=messages, temperature=0.3, stream=True
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta.content if chunk.choices else None
                    if delta:
                        answer += delta
                        yield "token", {"text": delta}
            else:
                # The loop's terminal completion IS the answer (regenerating
                # it just to stream would double cost and latency) - emit it
                # in chunks so the UI still renders progressively.
                yield "status", {"stage": "generating", "label": "Writing the answer"}
                for piece in _chunk_text(answer):
                    yield "token", {"text": piece}
        else:
            yield "status", {"stage": "generating", "label": "Writing the answer"}
            stream = _completion_with_retry(
                client, model=model, messages=messages, temperature=0.4, stream=True
            )
            for chunk in stream:
                delta = chunk.choices[0].delta.content if chunk.choices else None
                if delta:
                    answer += delta
                    yield "token", {"text": delta}

        route = "tools" if use_tools else "direct"
        answer = answer.strip() or _GENERIC_ERROR_MESSAGE

        chat_message = ChatMessage.objects.create(
            session=session,
            document=document,
            firm=user.firm,
            question=question,
            answer=answer,
            route=route,
            sources=sources,
            asked_by=user,
        )

        # "Single result rule": when this turn's case tools resolved to
        # exactly one case, remember it so bare follow-ups stay scoped to
        # it; when they resolved to zero or several, clear the scope.
        if case_tool_ran:
            session.active_case_id = (
                resolved_case_ids.pop() if len(resolved_case_ids) == 1 else None
            )
        session.save()  # also bumps updated_at

        yield "message", {
            "chat_id": chat_message.id,
            "chat_session_id": session.id,
            "answer": answer,
            "route": route,
            "sources": sources,
            "research_steps": research_steps,
        }

        # Post-turn learning, off-thread: memory extraction + style refresh.
        extract_and_store_async(user, user.firm, question, answer, chat_message)

    except _TurnError as error:
        yield "error", {"error": error.message}
    except _PROVIDER_STATUS_ERRORS as error:
        status_code = getattr(error, "status_code", None)
        if status_code == 413:
            yield "error", {"error": _TOO_LONG_MESSAGE}
        elif status_code == 429:
            yield "error", {"error": _PROVIDER_BUSY_MESSAGE}
        else:
            print(f"CHAT TURN PROVIDER ERROR: {error}")
            yield "error", {"error": _GENERIC_ERROR_MESSAGE}
    except Exception as error:
        # Never leak provider/internal details to the client; log server-side.
        print(f"CHAT TURN ERROR: {error}")
        yield "error", {"error": _GENERIC_ERROR_MESSAGE}

    yield "done", {}


def stream_chat_turn(user, payload) -> Generator[bytes, None, None]:
    """SSE byte stream for the HTTP endpoint."""
    for event, data in chat_turn_events(
        user,
        question=payload.question,
        chat_session_id=payload.chat_session_id,
        document_id=payload.document_id,
        case_id=payload.case_id,
        region=payload.region,
    ):
        yield sse(event, data)


def run_chat_turn_sync(
    user,
    question: str,
    chat_session_id: Optional[int] = None,
    document_id: Optional[str] = None,
    case_id: Optional[int] = None,
) -> Dict:
    """Drains one turn without SSE - used by tests and evals."""
    final: Dict = {}
    for event, data in chat_turn_events(
        user,
        question=question,
        chat_session_id=chat_session_id,
        document_id=document_id,
        case_id=case_id,
    ):
        if event == "message":
            final = data
        elif event == "error" and not final:
            final = {"answer": data["error"], "error": data["error"], "sources": [], "route": "error"}
    return final
