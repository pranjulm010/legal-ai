"""
Intent-detection layer: one fast structured-output call that decides
whether the turn needs tools and whether the user is correcting the
assistant. Fails safe: any parsing/provider problem routes to "tools",
the path that can ground itself in real data.
"""
from dataclasses import dataclass
from typing import Dict, List, Optional

from .llm import fast_json_completion
from .prompts.intent import INTENT_SYSTEM


@dataclass
class Intent:
    route: str                    # "tools" | "direct"
    is_correction: bool = False
    correction_summary: Optional[str] = None


def detect_intent(
    question: str,
    history: List[Dict],
    has_document: bool,
    has_case: bool,
) -> Intent:
    context_bits = []
    if has_document:
        context_bits.append("A firm document is attached to this conversation.")
    if has_case:
        context_bits.append("A specific case is active in this conversation.")
    for turn in history[-2:]:
        context_bits.append(f"Previous user message: {turn['question'][:200]}")

    user_content = "\n".join(context_bits + [f"User message: {question[:1000]}"])

    data = fast_json_completion(
        [
            {"role": "system", "content": INTENT_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        default={"route": "tools"},
        max_tokens=200,
    )

    route = data.get("route") if data.get("route") in ("tools", "direct") else "tools"
    summary = data.get("correction_summary")
    return Intent(
        route=route,
        is_correction=bool(data.get("is_correction")) and bool(summary),
        correction_summary=summary if isinstance(summary, str) else None,
    )
