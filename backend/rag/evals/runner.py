"""
Eval runner: sets up an isolated firm pre-loaded with the sample documents,
runs every golden case through the REAL pipeline (answer_question /
answer_general_question - no mocks), scores the results, and prints a
scorecard. This is the regression gate for retrieval/generation changes.
"""
import time
from typing import Dict, List, Optional

from django.contrib.auth.models import User
from django.utils.crypto import get_random_string

from accounts.models import Firm, LawyerProfile
from api.models import UploadedDocument
from cases.sample_data import seed_sample_documents

from ..rag_pipeline import answer_general_question, answer_question, build_context
from ..retriever import retrieve_context, retrieve_firm_context
from ..vector_store import get_chroma_client
from . import metrics
from .dataset import (
    DOC_DISPLAY_NAMES,
    GOLDEN_CASES,
    KIND_ANSWERABLE,
    EvalCase,
)

# A dedicated, clearly-labelled firm so eval data never mixes with a real
# firm's records. Reused across runs (re-embedding the samples every run is
# wasted work); pass fresh=True to rebuild it from scratch.
EVAL_FIRM_SLUG = "eval-harness-firm"
EVAL_FIRM_NAME = "Eval Harness Firm"
EVAL_USERNAME = "eval-harness-bot"


# ---------------------------------------------------------------------------
# Fixture setup / teardown
# ---------------------------------------------------------------------------

def _teardown(firm: Firm) -> None:
    """Drop the firm's vector collection and all its DB rows (cases,
    documents, lawyers cascade off the firm; the bot user is separate)."""
    try:
        get_chroma_client().delete_collection(name=f"legal_documents_firm_{firm.id}")
    except Exception:
        pass  # collection may not exist yet - nothing to drop
    firm.delete()
    User.objects.filter(username=EVAL_USERNAME).delete()


def setup_eval_firm(fresh: bool = False) -> Firm:
    existing = Firm.objects.filter(slug=EVAL_FIRM_SLUG).first()

    if existing and not fresh:
        return existing

    if existing:
        _teardown(existing)

    User.objects.filter(username=EVAL_USERNAME).delete()

    firm = Firm.objects.create(
        name=EVAL_FIRM_NAME,
        slug=EVAL_FIRM_SLUG,
        size="solo",
        default_region="india",
    )
    user = User.objects.create_user(username=EVAL_USERNAME, password=get_random_string(24))
    profile = LawyerProfile.objects.create(user=user, firm=firm, role="admin")

    # Seeds the same NDA / rental / employment documents used everywhere
    # else, chunked and embedded into the firm's vector collection.
    seed_sample_documents(firm, profile)

    return firm


def _resolve_document_ids(firm: Firm) -> Dict[str, str]:
    """Map each dataset doc key to the seeded document's UUID."""
    ids: Dict[str, str] = {}
    for key, display_name in DOC_DISPLAY_NAMES.items():
        doc = UploadedDocument.objects.filter(firm=firm, original_name=display_name).first()
        if doc and doc.total_chunks > 0:
            ids[key] = str(doc.document_id)
    return ids


# ---------------------------------------------------------------------------
# Running one case
# ---------------------------------------------------------------------------

def _run_case(case: EvalCase, firm: Firm, doc_ids: Dict[str, str], use_judge: bool) -> Dict:
    result_row: Dict = {"id": case.id, "kind": case.kind, "error": None}

    try:
        if case.doc:
            document_id = doc_ids.get(case.doc)
            if not document_id:
                result_row["error"] = f"sample document '{case.doc}' not seeded"
                return result_row
            retrieved = retrieve_context(case.question, document_id, firm.id, top_k=5)
            answer_result = answer_question(
                question=case.question,
                document_id=document_id,
                firm_id=firm.id,
                role="lawyer",
                allow_web_search=False,
                answer_mode="mixed",
                history=case.history,
            )
        else:
            retrieved = retrieve_firm_context(case.question, firm.id, top_k=5)
            answer_result = answer_general_question(
                question=case.question,
                firm=firm,
                role="lawyer",
                allow_web_search=False,
                answer_mode="mixed",
                history=case.history,
            )
    except Exception as error:  # noqa: BLE001 - one bad case shouldn't sink the run
        result_row["error"] = f"pipeline error: {str(error)[:200]}"
        return result_row

    raw_answer = answer_result.get("answer")
    answer_text = raw_answer if isinstance(raw_answer, str) else str(raw_answer or "")
    result_row["route"] = answer_result.get("route")
    result_row["answer_preview"] = answer_text[:160]

    if case.kind == KIND_ANSWERABLE:
        result_row["recall"] = metrics.retrieval_recall(retrieved, case.expected_snippets)
        if use_judge:
            correctness = metrics.judge_correctness(case.question, answer_text, case.expected_facts)
            grounded = metrics.judge_groundedness(answer_text, build_context(retrieved))
            result_row["correctness"] = correctness["pass"]
            result_row["correctness_reason"] = correctness["reason"]
            result_row["groundedness"] = grounded["pass"]
            result_row["groundedness_reason"] = grounded["reason"]
    else:
        ok, reason = metrics.scope_correct(case, answer_result)
        result_row["scope"] = ok
        result_row["scope_reason"] = reason

    return result_row


# ---------------------------------------------------------------------------
# Orchestration + scorecard
# ---------------------------------------------------------------------------

def run(
    limit: Optional[int] = None,
    only_ids: Optional[List[str]] = None,
    use_judge: bool = True,
    fresh: bool = False,
    sleep: float = 1.0,
    log=print,
) -> Dict:
    firm = setup_eval_firm(fresh=fresh)
    doc_ids = _resolve_document_ids(firm)

    cases = GOLDEN_CASES
    if only_ids:
        wanted = set(only_ids)
        cases = [c for c in cases if c.id in wanted]
    if limit:
        cases = cases[:limit]

    log(f"Running {len(cases)} eval case(s) against firm '{firm.name}' "
        f"(judge={'on' if use_judge else 'off'})\n")

    rows: List[Dict] = []
    for index, case in enumerate(cases, start=1):
        row = _run_case(case, firm, doc_ids, use_judge)
        rows.append(row)
        log(_format_case_line(row))
        # Space out calls so a run doesn't trip the Groq free-tier TPM limit.
        if sleep and index < len(cases):
            time.sleep(sleep)

    scorecard = _aggregate(rows)
    log("\n" + _format_scorecard(scorecard, rows))
    return {"rows": rows, "scorecard": scorecard}


def _mark(value: Optional[bool]) -> str:
    if value is None:
        return "  - "
    return "  PASS" if value else "  FAIL"


def _format_case_line(row: Dict) -> str:
    if row.get("error"):
        return f"  [{row['id']:<26}] ERROR: {row['error']}"

    if row["kind"] == KIND_ANSWERABLE:
        parts = [f"recall{_mark(row.get('recall'))}"]
        if "correctness" in row:
            parts.append(f"correct{_mark(row.get('correctness'))}")
            parts.append(f"grounded{_mark(row.get('groundedness'))}")
        return f"  [{row['id']:<26}] " + "  ".join(parts)

    return f"  [{row['id']:<26}] scope{_mark(row.get('scope'))}  ({row.get('scope_reason','')})"


def _rate(passed: int, total: int) -> str:
    if total == 0:
        return "n/a"
    return f"{passed}/{total} ({round(100 * passed / total)}%)"


def _aggregate(rows: List[Dict]) -> Dict:
    def tally(metric: str, kinds=None):
        passed = total = 0
        for row in rows:
            if row.get("error"):
                continue
            if kinds and row["kind"] not in kinds:
                continue
            if metric not in row:
                continue
            total += 1
            if row[metric]:
                passed += 1
        return passed, total

    return {
        "recall": tally("recall", {KIND_ANSWERABLE}),
        "correctness": tally("correctness", {KIND_ANSWERABLE}),
        "groundedness": tally("groundedness", {KIND_ANSWERABLE}),
        "scope": tally("scope"),
        "errors": sum(1 for row in rows if row.get("error")),
        "total": len(rows),
    }


def _format_scorecard(scorecard: Dict, rows: List[Dict]) -> str:
    lines = [
        "=" * 60,
        "  ANSWER-QUALITY SCORECARD",
        "=" * 60,
        f"  Retrieval recall@5   : {_rate(*scorecard['recall'])}",
        f"  Answer correctness   : {_rate(*scorecard['correctness'])}",
        f"  Groundedness         : {_rate(*scorecard['groundedness'])}",
        f"  Scope correctness    : {_rate(*scorecard['scope'])}",
        f"  Errors               : {scorecard['errors']}/{scorecard['total']}",
        "=" * 60,
    ]

    # Surface judge reasons for anything that failed - that's what makes the
    # scorecard actionable rather than just a number.
    failures = []
    for row in rows:
        for metric in ("correctness", "groundedness"):
            if row.get(metric) is False:
                failures.append(f"  - {row['id']} [{metric}]: {row.get(metric + '_reason', '')}")
        if row.get("scope") is False:
            failures.append(f"  - {row['id']} [scope]: {row.get('scope_reason', '')}")
        if row.get("recall") is False:
            failures.append(f"  - {row['id']} [recall]: expected snippet not retrieved")

    if failures:
        lines.append("  Failures:")
        lines.extend(failures)
        lines.append("=" * 60)

    return "\n".join(lines)
