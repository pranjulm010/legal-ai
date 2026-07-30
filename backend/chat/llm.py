"""
Thin Groq helpers for the chat pipeline's auxiliary calls (intent
detection, memory extraction, style summarization). The main answer and
tool-loop calls live in the orchestrator; per-firm key/model overrides are
honored via rag.groq_client / rag.llm_override.
"""
import json
from typing import Dict, List

from django.conf import settings

from rag.groq_client import get_groq_client


def fast_json_completion(messages: List[Dict], default: Dict, max_tokens: int = 600) -> Dict:
    """
    One small-model call that must return a JSON object. Groq's json_object
    mode occasionally emits prose or truncated JSON - any failure returns
    `default` so callers always get a usable dict and the turn never dies
    on an auxiliary call.
    """
    try:
        client = get_groq_client()
        response = client.chat.completions.create(
            model=settings.GROQ_FAST_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=max_tokens,
        )
        data = json.loads(response.choices[0].message.content)
        if not isinstance(data, dict):
            return default
        return data
    except Exception:
        return default
