"""
Memory RAG writers: distill conversation turns, feedback, and corrections
into MemoryEntry rows + vectors. Extraction runs in a background thread
after the response is already streamed - it must never add latency to or
crash a turn.
"""
import threading
from typing import Optional

from chat.llm import fast_json_completion
from chat.prompts.memory import MEMORY_EXTRACTION_SYSTEM

from .store import upsert_memory_vector

_VALID_KINDS = {"preference", "style", "fact"}
_MAX_MEMORIES_PER_TURN = 3


def extract_and_store(user, firm, question: str, answer: str, source_message=None) -> int:
    """Distill one completed turn into 0-3 memories. Returns how many were stored."""
    from chat.models import MemoryEntry

    data = fast_json_completion(
        [
            {"role": "system", "content": MEMORY_EXTRACTION_SYSTEM},
            {
                "role": "user",
                "content": f"User message:\n{question[:2000]}\n\nAssistant answer:\n{answer[:2000]}",
            },
        ],
        default={"memories": []},
    )

    stored = 0
    for item in (data.get("memories") or [])[:_MAX_MEMORIES_PER_TURN]:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        content = (item.get("content") or "").strip()
        if kind not in _VALID_KINDS or not content:
            continue
        # Skip near-duplicates: an identical sentence already remembered
        # adds noise, not signal.
        if MemoryEntry.objects.filter(user=user, content__iexact=content, is_active=True).exists():
            continue
        entry = MemoryEntry.objects.create(
            user=user,
            firm=firm,
            kind=kind,
            content=content,
            source_message=source_message,
        )
        upsert_memory_vector(entry)
        stored += 1
    return stored


def record_feedback_memory(user, message, comment: str = "") -> None:
    """A thumbs-down becomes a standing 'avoid this' memory."""
    from chat.models import MemoryEntry

    content = f"Disliked an answer about: {message.question[:120]}."
    if comment.strip():
        content += f' Their comment: "{comment.strip()[:200]}"'

    entry = MemoryEntry.objects.create(
        user=user,
        firm=user.firm,
        kind="feedback",
        content=content,
        source_message=message,
    )
    upsert_memory_vector(entry)


def record_correction_memory(user, firm, correction_summary: str, source_message=None) -> None:
    """A correction the user gave mid-conversation, stored synchronously so
    it can influence the very next answer."""
    from chat.models import MemoryEntry

    entry = MemoryEntry.objects.create(
        user=user,
        firm=firm,
        kind="correction",
        content=correction_summary.strip()[:500],
        source_message=source_message,
    )
    upsert_memory_vector(entry)


def extract_and_store_async(user, firm, question: str, answer: str, source_message=None) -> None:
    """Post-turn learning: memory extraction + style-profile refresh off the
    request thread (same daemon-thread pattern as document processing)."""

    def _run():
        try:
            extract_and_store(user, firm, question, answer, source_message)
            from .profile import maybe_refresh_style_profile

            maybe_refresh_style_profile(user)
        except Exception:
            # Background learning must never surface as a user-facing error.
            pass

    threading.Thread(target=_run, daemon=True).start()
