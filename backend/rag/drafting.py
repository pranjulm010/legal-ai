import json
from typing import Dict, List

from django.conf import settings

from .groq_client import get_groq_client

# Full document text is sent directly to the LLM for redlining (not the
# chunked/vector RAG pipeline) since a redline review needs the whole
# document in context. Capped to avoid exceeding the model's context
# window on very long contracts - not solved with pagination in this pass.
MAX_DOCUMENT_CHARS_FOR_REDLINE = 12000


def generate_draft(prompt: str, context: str = "") -> str:
    """
    Generate a fresh draft document/clause from a lawyer's instruction.
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
