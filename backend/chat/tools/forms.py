from .registry import ToolContext, ToolResult, result_json, tool


@tool(
    name="get_form_details",
    description=(
        "Look up the firm's legal/court forms by name, code (e.g. 'Form "
        "32A'), or category. Returns each form's purpose, required fields, "
        "jurisdiction, and submission link. Use when the user asks about a "
        "form, what a form needs, or which form applies."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Form name, code, or category to look up.",
            },
        },
        "required": ["query"],
    },
)
def get_form_details(ctx: ToolContext, query: str) -> ToolResult:
    from django.db.models import Q

    from legalforms.models import Form

    forms = list(
        Form.objects.filter(firm=ctx.firm).filter(
            Q(title__icontains=query)
            | Q(code__icontains=query)
            | Q(category__icontains=query)
            | Q(description__icontains=query)
        )[:5]
    )

    if not forms:
        return ToolResult(
            content=result_json(
                {"found": False, "note": f'No form matching "{query}" in the firm\'s form library.'}
            )
        )

    payload = {
        "found": True,
        "forms": [
            {
                "form_id": form.id,
                "title": form.title,
                "code": form.code,
                "category": form.category,
                "jurisdiction": form.jurisdiction,
                "description": form.description,
                "required_fields": form.required_fields,
                "submission_url": form.submission_url,
            }
            for form in forms
        ],
    }
    sources = [
        {"source_type": "form", "form_id": form.id, "form_title": form.title}
        for form in forms
    ]
    return ToolResult(content=result_json(payload), sources=sources)
