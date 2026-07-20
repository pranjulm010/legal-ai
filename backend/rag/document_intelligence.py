import json
from typing import Dict, List

from .llm_client import get_ai_client

# Full document text sent directly to the LLM (not the chunked RAG
# pipeline) since these operations need whole-document context. Capped to
# avoid exceeding the model's context window on very long documents.
MAX_DOCUMENT_CHARS = 12000


def _truncate(text: str) -> str:
    return text[:MAX_DOCUMENT_CHARS]


def summarize_document(document_text: str, firm=None) -> str:
    client = get_ai_client(firm)

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an Indian legal AI assistant. Summarize the document "
                    "for a lawyer: purpose, parties, key obligations, key dates, "
                    "and anything unusual. Use only what's in the document - do "
                    "not invent facts. Keep it concise and structured with "
                    "headings/bullets."
                ),
            },
            {"role": "user", "content": _truncate(document_text)},
        ],
        temperature=0.1,
        max_tokens=1200,
    )

    return response.choices[0].message.content


def generate_client_summary(document_text: str, firm=None) -> str:
    client = get_ai_client(firm)

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an Indian legal AI assistant. Explain this document "
                    "to a non-lawyer client: what it is, what it means for them, "
                    "and what they need to do or watch out for. Plain, simple "
                    "language, no legal jargon. Use only what's in the document."
                ),
            },
            {"role": "user", "content": _truncate(document_text)},
        ],
        temperature=0.2,
        max_tokens=1000,
    )

    return response.choices[0].message.content


def extract_entities(document_text: str, firm=None) -> Dict:
    """
    Structured entity extraction from OCR'd/parsed document text: dates,
    parties, case number, court name, sections/clauses referenced,
    monetary amounts, and addresses. Returns {} on any parsing failure
    rather than raising, so a bad LLM response degrades gracefully.
    """
    client = get_ai_client(firm)

    system_prompt = """
Extract structured entities from the legal document text below. Return
ONLY a JSON object of this exact form:
{
  "dates": ["..."],
  "parties": ["..."],
  "case_number": "..." or null,
  "court_name": "..." or null,
  "sections_referenced": ["..."],
  "amounts": ["..."],
  "addresses": ["..."]
}

Rules:
1. Only include values that literally appear in the text - never invent.
2. Use empty lists / null where nothing is found.
3. "amounts" means monetary figures (e.g. "Rs. 35,000").
"""

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": _truncate(document_text)},
        ],
        temperature=0,
        max_tokens=1000,
        response_format={"type": "json_object"},
    )

    try:
        parsed = json.loads(response.choices[0].message.content)
        return {
            "dates": parsed.get("dates", []) or [],
            "parties": parsed.get("parties", []) or [],
            "case_number": parsed.get("case_number"),
            "court_name": parsed.get("court_name"),
            "sections_referenced": parsed.get("sections_referenced", []) or [],
            "amounts": parsed.get("amounts", []) or [],
            "addresses": parsed.get("addresses", []) or [],
        }
    except (json.JSONDecodeError, AttributeError):
        return {}


def analyze_risks(document_text: str, firm=None) -> List[Dict]:
    """
    Flags legal/commercial risk areas in a document (unlimited liability,
    one-sided indemnities, missing notice periods, ambiguous termination,
    unfavorable jurisdiction, etc.) - similar lens to redlining, but
    framed as a standalone risk report rather than clause-by-clause edits.
    """
    client = get_ai_client(firm)

    system_prompt = """
You are an Indian legal AI assistant performing a risk analysis of a document.

Return ONLY a JSON object of this exact form:
{"risks": [{"clause_excerpt": "...", "risk": "...", "severity": "low|medium|high"}]}

Rules:
1. "clause_excerpt" must be an exact substring copied from the document.
2. Do not invent clauses or facts not in the document.
3. If there are no meaningful risks, return an empty risks array.
"""

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": _truncate(document_text)},
        ],
        temperature=0.1,
        max_tokens=1500,
        response_format={"type": "json_object"},
    )

    try:
        parsed = json.loads(response.choices[0].message.content)
        risks = parsed.get("risks", [])

        if not isinstance(risks, list):
            return []

        return [
            {
                "clause_excerpt": item.get("clause_excerpt", ""),
                "risk": item.get("risk", ""),
                "severity": item.get("severity", "medium"),
            }
            for item in risks
            if isinstance(item, dict) and item.get("clause_excerpt")
        ]
    except (json.JSONDecodeError, AttributeError):
        return []


def compare_documents(text_a: str, name_a: str, text_b: str, name_b: str, firm=None) -> str:
    client = get_ai_client(firm)

    user_prompt = f"""
Document A ({name_a}):
{_truncate(text_a)}

Document B ({name_b}):
{_truncate(text_b)}

Compare these two documents for a lawyer: what's materially different
(parties, obligations, amounts, dates, termination terms), and what's in
one but missing from the other. Use only what's in the documents.
"""

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an Indian legal AI assistant comparing two documents. "
                    "Be specific and structured (use headings/bullets). Do not "
                    "invent facts not present in either document."
                ),
            },
            {"role": "user", "content": user_prompt.strip()},
        ],
        temperature=0.1,
        max_tokens=1500,
    )

    return response.choices[0].message.content


COMPLIANCE_CHECKLIST = [
    "Confidentiality / non-disclosure obligations",
    "Governing law and jurisdiction",
    "Termination rights and notice periods",
    "Limitation of liability",
    "Indemnification",
    "Dispute resolution mechanism",
    "Force majeure",
    "Payment terms and late payment consequences",
    "Assignment / subcontracting restrictions",
    "Data protection / privacy obligations",
]


def check_compliance(document_text: str, firm=None) -> List[Dict]:
    """
    Compliance Agent: checks a document against a standard checklist of
    commonly-expected clauses and flags what's missing, plus any
    regulatory/risk concerns found in what IS present.
    """
    client = get_ai_client(firm)

    checklist_text = "\n".join(f"- {item}" for item in COMPLIANCE_CHECKLIST)

    system_prompt = f"""
You are an Indian legal AI compliance assistant. Check the document against
this standard checklist of commonly-expected clauses:

{checklist_text}

Return ONLY a JSON object of this exact form:
{{"findings": [{{"item": "...", "status": "present|missing|weak", "note": "..."}}]}}

Rules:
1. One entry per checklist item above, in the same order.
2. "present" = clearly addressed in the document. "missing" = not found at
   all. "weak" = mentioned but vague/one-sided/incomplete.
3. "note" briefly explains why, referencing the document where relevant.
4. Do not invent clauses or facts not in the document.
"""

    response = client.chat.completions.create(
        model=client.default_model,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": _truncate(document_text)},
        ],
        temperature=0.1,
        max_tokens=1500,
        response_format={"type": "json_object"},
    )

    try:
        parsed = json.loads(response.choices[0].message.content)
        findings = parsed.get("findings", [])

        if not isinstance(findings, list):
            return []

        return [
            {
                "item": item.get("item", ""),
                "status": item.get("status", "missing"),
                "note": item.get("note", ""),
            }
            for item in findings
            if isinstance(item, dict) and item.get("item")
        ]
    except (json.JSONDecodeError, AttributeError):
        return []
