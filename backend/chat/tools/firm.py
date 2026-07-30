from .registry import ToolContext, ToolResult, result_json, tool


@tool(
    name="get_firm_overview",
    description=(
        "Get the firm's live database overview: case counts by status and "
        "type (with titles), lawyers, upcoming reminders, and document/"
        "draft/contact totals. Use for any question about the firm's own "
        "records - how many cases, which are open, who works here, "
        "upcoming deadlines - then answer using the exact numbers returned. "
        "This does NOT search inside uploaded documents' text - a name or "
        "term absent here may still exist only inside a document; use "
        "search_documents for that."
    ),
    parameters={"type": "object", "properties": {}},
)
def get_firm_overview(ctx: ToolContext) -> ToolResult:
    from django.utils import timezone

    from api.models import UploadedDocument
    from cases.models import Case, Contact, Reminder
    from accounts.models import LawyerProfile
    from drafts.models import Draft

    cases = list(
        Case.objects.filter(firm=ctx.firm).values(
            "id", "title", "case_type", "status", "client_name"
        )[:100]
    )

    by_status: dict = {}
    by_type: dict = {}
    for case in cases:
        by_status[case["status"]] = by_status.get(case["status"], 0) + 1
        by_type[case["case_type"]] = by_type.get(case["case_type"], 0) + 1

    lawyers = [
        {
            "name": profile.user.get_full_name() or profile.user.username,
            "role": profile.role,
        }
        for profile in LawyerProfile.objects.filter(firm=ctx.firm).select_related("user")
    ]

    upcoming_reminders = [
        {
            "title": reminder.title,
            "case": reminder.case.title,
            "due_date": reminder.due_date.isoformat(),
        }
        for reminder in Reminder.objects.filter(
            case__firm=ctx.firm, is_completed=False, due_date__gte=timezone.now()
        ).select_related("case").order_by("due_date")[:10]
    ]

    payload = {
        "total_cases": len(cases),
        "cases_by_status": by_status,
        "cases_by_type": by_type,
        "cases": cases,
        "lawyers": lawyers,
        "upcoming_reminders": upcoming_reminders,
        "total_documents": UploadedDocument.objects.filter(firm=ctx.firm).count(),
        "total_drafts": Draft.objects.filter(firm=ctx.firm).count(),
        "total_contacts": Contact.objects.filter(firm=ctx.firm).count(),
    }
    return ToolResult(
        content=result_json(payload),
        sources=[{"source_type": "firm_database", "label": "Firm database overview"}],
    )
