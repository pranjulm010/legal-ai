import json
from typing import Dict, List, Optional

from django.conf import settings

from .groq_client import get_groq_client

# Full document text is sent directly to the LLM for redlining (not the
# chunked/vector RAG pipeline) since a redline review needs the whole
# document in context. Capped to avoid exceeding the model's context
# window on very long contracts - not solved with pagination in this pass.
MAX_DOCUMENT_CHARS_FOR_REDLINE = 12000

# Same rationale for template analysis: the whole sample document is sent
# to the LLM so it can infer the full structure, not a chunked subset.
MAX_DOCUMENT_CHARS_FOR_TEMPLATE = 12000


def analyze_template(document_text: str) -> Dict:
    """
    Distill a reusable drafting template from a sample document.

    Returns a dict with the facets shown to the user:
        {
          "extracted_structure": str,   # section/heading outline
          "tone": str,                  # register/voice description
          "formatting_rules": str,      # numbering, headings, defined terms...
          "placeholders": [             # variable fields to fill per draft
            {"name": "LANDLORD_NAME", "description": "Full name of the landlord"},
            ...
          ],
          "ai_prompt": str,             # synthesized instruction for reuse
        }

    Never raises on malformed model output - returns empty/degraded fields
    instead so a bad LLM response doesn't 500 the upload request.
    """

    client = get_groq_client()

    truncated_text = document_text[:MAX_DOCUMENT_CHARS_FOR_TEMPLATE]

    system_prompt = """
You are an Indian legal AI that reverse-engineers a reusable drafting template
from one sample legal document.

Return ONLY a JSON object of this exact form:
{
  "extracted_structure": "A numbered outline of the document's sections/clauses in order.",
  "tone": "A short description of the register and voice (e.g. formal, third-person, statutory).",
  "formatting_rules": "The concrete formatting conventions: heading style, clause numbering, use of defined terms, salutation/closing, signature blocks, etc.",
  "placeholders": [
    {"name": "SHORT_UPPER_SNAKE_CASE", "description": "What this field is and where it appears"}
  ],
  "ai_prompt": "A self-contained instruction that, given only the placeholder values, would let an AI reproduce a document in exactly this format, structure and tone."
}

Rules:
1. Derive everything strictly from the sample - do not invent sections that are not present.
2. "placeholders" must capture every variable that changes between two documents of this type: party names, addresses, dates, amounts, durations, notice periods, jurisdictions, etc. Use UPPER_SNAKE_CASE names.
3. Keep "ai_prompt" format-focused - it describes HOW to draft, not the specific facts.
4. Return valid JSON only, no prose outside the object.
"""

    user_prompt = f"""
Sample document to analyze:
{truncated_text}
"""

    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": user_prompt.strip()},
        ],
        temperature=0.1,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )

    raw_content = response.choices[0].message.content

    empty = {
        "extracted_structure": "",
        "tone": "",
        "formatting_rules": "",
        "placeholders": [],
        "ai_prompt": "",
    }

    try:
        parsed = json.loads(raw_content)
    except (json.JSONDecodeError, TypeError):
        return empty

    if not isinstance(parsed, dict):
        return empty

    raw_placeholders = parsed.get("placeholders", [])
    placeholders = [
        {
            "name": str(item.get("name", "")).strip(),
            "description": str(item.get("description", "")).strip(),
        }
        for item in raw_placeholders
        if isinstance(item, dict) and item.get("name")
    ] if isinstance(raw_placeholders, list) else []

    return {
        "extracted_structure": str(parsed.get("extracted_structure", "") or ""),
        "tone": str(parsed.get("tone", "") or ""),
        "formatting_rules": str(parsed.get("formatting_rules", "") or ""),
        "placeholders": placeholders,
        "ai_prompt": str(parsed.get("ai_prompt", "") or ""),
    }


def _build_template_guidance(template: Optional[Dict], values: Optional[Dict]) -> str:
    """
    Render a saved template + the draft author's placeholder values into a
    block of extra instructions appended to the drafting system prompt.
    Returns "" when no template is supplied (plain prompt-only drafting).
    """

    if not template:
        return ""

    parts = ["You MUST follow this saved template exactly - match its structure, tone and formatting."]

    if template.get("extracted_structure"):
        parts.append(f"\nDocument structure to follow:\n{template['extracted_structure']}")
    if template.get("tone"):
        parts.append(f"\nTone:\n{template['tone']}")
    if template.get("formatting_rules"):
        parts.append(f"\nFormatting rules:\n{template['formatting_rules']}")
    if template.get("ai_prompt"):
        parts.append(f"\nFormat instruction:\n{template['ai_prompt']}")

    values = values or {}
    filled = {k: v for k, v in values.items() if str(v).strip()}
    placeholders = template.get("placeholders") or []

    if placeholders:
        lines = []
        for item in placeholders:
            name = item.get("name", "")
            if not name:
                continue
            given = filled.get(name)
            if given:
                lines.append(f"- {name}: {given}")
            else:
                # Left blank on purpose - keep it as a bracketed placeholder.
                lines.append(f"- {name}: [{name}] (not provided - keep as a bracketed placeholder)")
        if lines:
            parts.append(
                "\nPlaceholder values to substitute into the document. "
                "Where a value is given, write the value directly in the text and "
                "do NOT also print the placeholder token. Where a value is not "
                "given, keep the bracketed token so a human can fill it in later:\n"
                + "\n".join(lines)
            )

    return "\n".join(parts)


def generate_draft(
    prompt: str,
    context: str = "",
    template: Optional[Dict] = None,
    placeholder_values: Optional[Dict] = None,
) -> str:
    """
    Generate a fresh draft document/clause from a lawyer's instruction.

    When ``template`` is supplied (a DraftTemplate serialized to a dict), the
    draft is produced in that saved format/tone/structure, with
    ``placeholder_values`` substituted for the template's variable fields.
    """

    client = get_groq_client()

    system_prompt = """
You are an Indian legal AI drafting assistant.

Rules:
1. Draft a complete, professional legal document or clause based on the user's instruction.
2. Use standard Indian legal drafting conventions and formatting.
3. Do not invent specific facts (names, dates, amounts) beyond what the user provided - use clearly marked placeholders like [PARTY NAME] or [DATE] where information is missing.
4. Keep the draft structured with clear headings/clauses where appropriate.
5. End with:
   "Disclaimer: This is an AI-generated draft for informational purposes only and must be reviewed by a qualified lawyer before use."
"""

    template_guidance = _build_template_guidance(template, placeholder_values)
    if template_guidance:
        system_prompt = system_prompt.strip() + "\n\n" + template_guidance

    user_prompt = f"""
Instruction:
{prompt}

Additional context (may be empty):
{context}

Now produce the complete draft.
"""

    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": user_prompt.strip()},
        ],
        temperature=0.2,
        max_tokens=2000,
    )

    return response.choices[0].message.content


def generate_redline_suggestions(document_text: str, instructions: str = "") -> List[Dict]:
    """
    Review a document and return structured redline suggestions.
    Never raises on malformed model output - returns an empty list instead,
    so a bad LLM response degrades gracefully rather than 500ing the request.
    """

    client = get_groq_client()

    truncated_text = document_text[:MAX_DOCUMENT_CHARS_FOR_REDLINE]

    system_prompt = """
You are an Indian legal AI assistant performing a redline review of a document.

Return ONLY a JSON object of this exact form:
{"suggestions": [{"original_text": "...", "suggested_text": "...", "reason": "..."}]}

Rules:
1. Each "original_text" must be an exact substring copied from the document.
2. Do not invent clauses or facts that are not in the document.
3. Focus on real legal/commercial risk issues (unlimited liability, missing/short notice periods, one-sided indemnities, ambiguous terms, unfavorable jurisdiction, etc.), not stylistic nitpicks.
4. If there are no meaningful issues, return an empty suggestions array.
"""

    user_prompt = f"""
Additional review instructions (may be empty):
{instructions}

Document to review:
{truncated_text}
"""

    response = client.chat.completions.create(
        model=settings.GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt.strip()},
            {"role": "user", "content": user_prompt.strip()},
        ],
        temperature=0.1,
        max_tokens=2000,
        response_format={"type": "json_object"},
    )

    raw_content = response.choices[0].message.content

    try:
        parsed = json.loads(raw_content)
        suggestions = parsed.get("suggestions", [])

        if not isinstance(suggestions, list):
            return []

        return [
            {
                "original_text": item.get("original_text", ""),
                "suggested_text": item.get("suggested_text", ""),
                "reason": item.get("reason", ""),
            }
            for item in suggestions
            if isinstance(item, dict) and item.get("original_text")
        ]
    except (json.JSONDecodeError, AttributeError):
        return []
