"""
Metrics for the eval harness.

Deterministic checks (retrieval recall, scope correctness) need no LLM.
Correctness and groundedness are graded by an LLM judge - the same Groq
model the pipeline uses, pinned to temperature 0 and asked for a strict
pass/fail JSON verdict, so the grade is reproducible and cheap.
"""
import json
import re
import time
from typing import Dict, List, Tuple

from django.conf import settings

from ..groq_client import get_groq_client
from ..rag_pipeline import (
    NOT_LAW_RELATED_MESSAGE,
    ROUTE_FIRM_DATABASE,
    ROUTE_LLM_KNOWLEDGE,
    ROUTE_UPLOADED_DOCUMENT,
)
from ..groq_client import is_insufficient_answer
from .dataset import (
    EvalCase,
    KIND_GENERAL_KNOWLEDGE,
    KIND_INSUFFICIENT,
    KIND_NOT_LAW,
)


# ---------------------------------------------------------------------------
# Deterministic metrics
# ---------------------------------------------------------------------------

def retrieval_recall(retrieved_chunks: List[Dict], expected_snippets: List[str]) -> bool:
    """
    True when every expected snippet appears in at least one retrieved chunk.
    A snippet is a literal substring of the source document (see dataset.py),
    so this measures whether retrieval actually surfaced the passage that
    holds the answer - the ceiling on how correct the answer can possibly be.
    """
    if not expected_snippets:
        return True

    haystack = "\n".join(chunk.get("text", "") for chunk in retrieved_chunks)
    return all(snippet in haystack for snippet in expected_snippets)


def scope_correct(case: EvalCase, result: Dict) -> Tuple[bool, str]:
    """
    For the non-answerable kinds, "correct" means the pipeline did not
    fabricate a document answer:

      not_law           -> returns the plain not-a-legal-question message.
      insufficient      -> admits it, or routes away from any document
                           source (never claims a document/firm answer).
      general_knowledge -> answers from general knowledge (llm_knowledge),
                           not from a document it doesn't have.
    """
    # Coerce defensively: a malformed pipeline result (e.g. a non-string
    # answer) should be graded as a failure and surfaced, never crash the run.
    raw_answer = result.get("answer")
    answer = (raw_answer if isinstance(raw_answer, str) else str(raw_answer or "")).strip()
    route = result.get("route")

    if case.kind == KIND_NOT_LAW:
        ok = NOT_LAW_RELATED_MESSAGE in answer
        return ok, "returned not-a-legal-question message" if ok else f"expected refusal, got route={route}"

    if case.kind == KIND_INSUFFICIENT:
        # Passing means it did NOT present a document/firm answer for a fact
        # that lives in no document - either by saying so outright, or by
        # falling through to general knowledge instead of a document route.
        admitted = is_insufficient_answer(answer)
        no_doc_route = route not in (ROUTE_UPLOADED_DOCUMENT, ROUTE_FIRM_DATABASE)
        ok = admitted or no_doc_route
        reason = (
            "admitted insufficient context" if admitted
            else f"did not use a document route (route={route})" if ok
            else f"fabricated a document answer (route={route})"
        )
        return ok, reason

    if case.kind == KIND_GENERAL_KNOWLEDGE:
        ok = route == ROUTE_LLM_KNOWLEDGE
        return ok, "answered from general knowledge" if ok else f"expected general-knowledge route, got route={route}"

    return True, "n/a"


# ---------------------------------------------------------------------------
# LLM judge
# ---------------------------------------------------------------------------

_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _judge(system_prompt: str, user_prompt: str, retries: int = 3) -> Dict:
    """
    Ask the judge model for a strict {"verdict": "pass"|"fail", "reason": ...}
    JSON object. Retries on Groq rate limits (the free tier's TPM budget is
    tight and a run makes many calls), and fails closed to a 'fail' verdict
    on any unrecoverable error so a broken judge never silently inflates the
    score.
    """
    client = get_groq_client()

    for attempt in range(retries):
        try:
            response = client.chat.completions.create(
                model=settings.GROQ_MODEL,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0,
                max_tokens=300,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content or ""
            match = _JSON_RE.search(content)
            data = json.loads(match.group(0) if match else content)
            verdict = str(data.get("verdict", "")).lower().strip()
            return {
                "pass": verdict == "pass",
                "reason": str(data.get("reason", ""))[:300],
            }
        except Exception as error:  # noqa: BLE001 - judge must never crash the run
            message = str(error).lower()
            is_rate_limit = "rate limit" in message or "429" in message
            if is_rate_limit and attempt < retries - 1:
                # Honour an explicit Retry-After if Groq gave one, else back off.
                wait = _retry_after_seconds(str(error)) or (2 * (attempt + 1))
                time.sleep(wait)
                continue
            if attempt < retries - 1:
                time.sleep(1)
                continue
            return {"pass": False, "reason": f"judge error: {str(error)[:200]}"}


_RETRY_AFTER_RE = re.compile(r"try again in ([\d.]+)s", re.I)


def _retry_after_seconds(message: str) -> float:
    match = _RETRY_AFTER_RE.search(message)
    return float(match.group(1)) + 0.5 if match else 0.0


def judge_correctness(question: str, answer: str, expected_facts: List[str]) -> Dict:
    """Does the answer state the expected ground-truth facts, without
    contradicting them? Missing facts or wrong values -> fail."""
    system = (
        "You grade a legal AI assistant's answer against a list of ground-truth "
        "facts. Respond ONLY with JSON: {\"verdict\": \"pass\" or \"fail\", "
        "\"reason\": \"...\"}. Verdict is \"pass\" only if the answer states every "
        "ground-truth fact correctly and contradicts none of them. Ignore extra "
        "context, disclaimers, and wording differences - grade only the facts."
    )
    facts = "\n".join(f"- {fact}" for fact in expected_facts)
    user = f"Question:\n{question}\n\nGround-truth facts:\n{facts}\n\nAssistant answer:\n{answer}"
    return _judge(system, user)


def judge_groundedness(answer: str, context: str) -> Dict:
    """Is every factual claim in the answer supported by the retrieved
    context? Any claim not backed by the context -> fail (a hallucination),
    even if it happens to be true in general."""
    system = (
        "You check whether a legal AI answer is grounded in the provided source "
        "context. Respond ONLY with JSON: {\"verdict\": \"pass\" or \"fail\", "
        "\"reason\": \"...\"}. Verdict is \"pass\" only if every specific factual "
        "claim in the answer (names, numbers, dates, clauses, obligations) is "
        "supported by the context below. If the answer adds specific facts not in "
        "the context, verdict is \"fail\". Ignore generic legal disclaimers and "
        "plain-language restatements of the context."
    )
    user = f"Source context:\n{context}\n\nAssistant answer:\n{answer}"
    return _judge(system, user)
