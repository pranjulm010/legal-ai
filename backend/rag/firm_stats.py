import re
from typing import Optional


def _open_cases(firm) -> int:
    from cases.models import Case
    return Case.objects.filter(firm=firm).exclude(status="closed").count()


def _total_cases(firm) -> int:
    from cases.models import Case
    return Case.objects.filter(firm=firm).count()


def _cases_by_type(firm, case_type: str) -> int:
    from cases.models import Case
    return Case.objects.filter(firm=firm, case_type=case_type).count()


def _total_documents(firm) -> int:
    from api.models import UploadedDocument
    return UploadedDocument.objects.filter(firm=firm).count()


def _open_reminders(firm) -> int:
    from cases.models import Reminder
    return Reminder.objects.filter(case__firm=firm, is_completed=False).count()


def _overdue_reminders(firm) -> int:
    from django.utils import timezone
    from cases.models import Reminder
    return Reminder.objects.filter(
        case__firm=firm, is_completed=False, due_date__lt=timezone.now()
    ).count()


def _total_lawyers(firm) -> int:
    from accounts.models import LawyerProfile
    return LawyerProfile.objects.filter(firm=firm).count()


def _total_drafts(firm) -> int:
    from drafts.models import Draft
    return Draft.objects.filter(firm=firm).count()


def _total_contacts(firm) -> int:
    from cases.models import Contact
    return Contact.objects.filter(firm=firm).count()


def _cases_by_category(firm):
    from django.db.models import Count
    from cases.models import Case

    rows = (
        Case.objects.filter(firm=firm)
        .values("case_type")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    label_map = dict(Case.CASE_TYPE_CHOICES)
    return [(label_map.get(r["case_type"], r["case_type"]), r["n"]) for r in rows]


def _cases_by_status(firm):
    from django.db.models import Count
    from cases.models import Case

    rows = (
        Case.objects.filter(firm=firm)
        .values("status")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    label_map = dict(Case.STATUS_CHOICES)
    return [(label_map.get(r["status"], r["status"]), r["n"]) for r in rows]


def _cases_by_lawyer(firm):
    from cases.models import Case

    cases = Case.objects.filter(firm=firm).prefetch_related("assigned_lawyers__user")
    counts: dict = {}
    unassigned = 0

    for case in cases:
        lawyers = list(case.assigned_lawyers.all())
        if not lawyers:
            unassigned += 1
            continue
        for profile in lawyers:
            name = profile.user.get_full_name() or profile.user.username
            counts[name] = counts.get(name, 0) + 1

    rows = sorted(counts.items(), key=lambda kv: -kv[1])
    if unassigned:
        rows.append(("Unassigned", unassigned))
    return rows


def _cases_by_client(firm):
    from django.db.models import Count
    from cases.models import Case

    rows = (
        Case.objects.filter(firm=firm)
        .values("client_name")
        .annotate(n=Count("id"))
        .order_by("-n")
    )
    return [(r["client_name"] or "Unspecified client", r["n"]) for r in rows]


def _cases_breakdown(firm, group_by: str) -> str:
    """
    Groups the firm's cases by category (case type), status, assigned
    lawyer, or client, and reports counts per group straight from the
    database - the same never-hallucinate guarantee as every other
    meta-question answer, just aggregated instead of a single count/list.
    """
    from cases.models import Case

    total = Case.objects.filter(firm=firm).count()

    if group_by == "lawyer":
        rows = _cases_by_lawyer(firm)
        dimension_label = "assigned lawyer"
    elif group_by == "status":
        rows = _cases_by_status(firm)
        dimension_label = "status"
    elif group_by == "client":
        rows = _cases_by_client(firm)
        dimension_label = "client"
    else:
        rows = _cases_by_category(firm)
        dimension_label = "category"

    if total == 0:
        return "You have no cases yet to break down."

    if not rows:
        return f"You have {total} case(s), but none have a {dimension_label} assigned yet."

    parts = ", ".join(f"{label}: {count}" for label, count in rows)
    return f"Case breakdown by {dimension_label} - {parts}. ({total} case(s) total.)"


def _list_preview(names, noun_singular: str, noun_plural: str = "") -> str:
    noun_plural = noun_plural or f"{noun_singular}s"

    if not names:
        return f"You have no {noun_plural} yet."

    preview = ", ".join(names[:10])
    remainder = f", and {len(names) - 10} more" if len(names) > 10 else ""
    noun = noun_singular if len(names) == 1 else noun_plural

    return f"You have {len(names)} {noun}: {preview}{remainder}."


def _case_titles(firm):
    from cases.models import Case
    return list(Case.objects.filter(firm=firm).order_by("-created_at").values_list("title", flat=True))


def _case_titles_by_type(firm, case_type: str):
    from cases.models import Case
    return list(
        Case.objects.filter(firm=firm, case_type=case_type).order_by("-created_at").values_list("title", flat=True)
    )


def _case_titles_by_status(firm, status: str):
    from cases.models import Case
    return list(
        Case.objects.filter(firm=firm, status=status).order_by("-created_at").values_list("title", flat=True)
    )


def _cases_filtered_queryset(firm, case_type: Optional[str] = None, status: Optional[str] = None):
    from cases.models import Case

    qs = Case.objects.filter(firm=firm)
    if case_type:
        qs = qs.filter(case_type=case_type)
    if status:
        # "open" means "not closed" everywhere else in this file (in_progress/
        # on_hold cases are still open) - kept consistent here too.
        qs = qs.exclude(status="closed") if status == "open" else qs.filter(status=status)
    return qs


def _case_count_filtered(firm, case_type: Optional[str] = None, status: Optional[str] = None) -> int:
    return _cases_filtered_queryset(firm, case_type, status).count()


def _case_titles_filtered(firm, case_type: Optional[str] = None, status: Optional[str] = None):
    return list(
        _cases_filtered_queryset(firm, case_type, status)
        .order_by("-created_at")
        .values_list("title", flat=True)
    )


def _filtered_case_label(case_type: Optional[str], status: Optional[str]) -> str:
    parts = [p for p in (status, case_type) if p]
    return f"{' '.join(parts)} case" if parts else "case"


def _unassigned_case_titles(firm):
    from cases.models import Case
    return list(
        Case.objects.filter(firm=firm, assigned_lawyers__isnull=True)
        .order_by("-created_at")
        .values_list("title", flat=True)
    )


def _find_lawyer_by_name(firm, name: str):
    """
    Fuzzy-matches a free-text name ("Lawyer A", "John", "Smith") against
    the firm's own lawyers by full name or username - a lawyer's software
    username is often not their real name, and a partial name is the most
    natural way for someone to refer to a colleague, so an exact match
    would miss the common case. Returns a list of matching LawyerProfiles
    (empty if none, more than one if the name is ambiguous) so the caller
    can decide how to respond to each case.
    """
    from accounts.models import LawyerProfile

    lowered = name.strip().lower()
    if not lowered:
        return []

    matches = []
    for profile in LawyerProfile.objects.filter(firm=firm).select_related("user"):
        full_name = (profile.user.get_full_name() or "").lower()
        username = profile.user.username.lower()
        if lowered == full_name or lowered == username:
            return [profile]
        if lowered in full_name or lowered in username:
            matches.append(profile)
    return matches


def _case_titles_by_lawyer_name(firm, name: str):
    from cases.models import Case

    matches = _find_lawyer_by_name(firm, name)
    if not matches:
        return None, None
    if len(matches) > 1:
        names = [p.user.get_full_name() or p.user.username for p in matches]
        return None, names

    titles = list(
        Case.objects.filter(firm=firm, assigned_lawyers=matches[0])
        .order_by("-created_at")
        .values_list("title", flat=True)
    )
    return titles, None


def _open_case_titles(firm):
    from cases.models import Case
    # "open" here means "not closed" (matches _open_cases' count semantics
    # above) rather than the single literal status="open" value, so
    # in_progress/on_hold cases - which are also still active - aren't
    # dropped from a "show open cases" listing.
    return list(
        Case.objects.filter(firm=firm).exclude(status="closed").order_by("-created_at").values_list("title", flat=True)
    )


def _document_names(firm):
    from api.models import UploadedDocument
    return list(
        UploadedDocument.objects.filter(firm=firm).order_by("-uploaded_at").values_list("original_name", flat=True)
    )


def _lawyer_names(firm):
    from accounts.models import LawyerProfile
    profiles = LawyerProfile.objects.filter(firm=firm).select_related("user")
    return [f"{p.user.get_full_name() or p.user.username} ({p.role})" for p in profiles]


def _draft_titles(firm):
    from drafts.models import Draft
    return list(Draft.objects.filter(firm=firm).order_by("-created_at").values_list("title", flat=True))


def _contact_names(firm):
    from cases.models import Contact
    return list(Contact.objects.filter(firm=firm).order_by("-created_at").values_list("name", flat=True))


def _overdue_reminder_titles(firm):
    from django.utils import timezone
    from cases.models import Reminder
    return list(
        Reminder.objects.filter(case__firm=firm, is_completed=False, due_date__lt=timezone.now())
        .order_by("due_date")
        .values_list("title", flat=True)
    )


def _open_reminder_titles(firm):
    from cases.models import Reminder
    return list(
        Reminder.objects.filter(case__firm=firm, is_completed=False)
        .order_by("due_date")
        .values_list("title", flat=True)
    )


def _drive_summary(firm) -> str:
    from accounts.models import GoogleDriveConnection
    from api.models import UploadedDocument

    connection = GoogleDriveConnection.objects.filter(firm=firm).first()
    if connection is None:
        return "Google Drive isn't connected for your firm yet - connect it from the Team page."

    scope = f'the folder "{connection.folder_name}"' if connection.folder_id else "your whole connected Drive"

    names = list(
        UploadedDocument.objects.filter(firm=firm, source="drive")
        .order_by("-uploaded_at")
        .values_list("original_name", flat=True)
    )

    if not names:
        return (
            f"Google Drive is connected, scoped to {scope}, but nothing has been synced "
            'yet - click "Sync now" on the Team page to index its PDFs.'
        )

    preview = ", ".join(names[:10])
    remainder = f", and {len(names) - 10} more" if len(names) > 10 else ""
    last_synced = f" Last synced {connection.last_synced_at:%Y-%m-%d %H:%M}." if connection.last_synced_at else ""

    return (
        f"You have {len(names)} document(s) synced from Google Drive ({scope}): "
        f"{preview}{remainder}.{last_synced}"
    )


# Each entry is (entity_group, pattern, handler). try_answer_firm_stats
# fires AT MOST ONE handler per entity_group - the first (i.e. most
# specific) pattern in that group that matches wins, and every other
# pattern in the same group is skipped even if it would also match.
#
# This is the key structural fix over a flat "run every matching pattern"
# list: a flat list is inherently fragile as more phrasings are added,
# because two patterns for the *same* entity (e.g. "cases by lawyer" vs
# the broader "categorize cases") can both match one question and their
# answers get concatenated into a contradictory reply. Grouping by entity
# and taking only the first match removes that whole class of bug - a new
# pattern only ever needs to be placed in priority order within its own
# entity's group, never written to defensively exclude every other
# pattern already in the file. Different entity_groups can still combine
# freely, so compound questions ("how many cases and documents") keep
# producing both answers.
# "How many X" is only one of several natural ways to ask a count
# question - "do we have any X", "is there an X", "are there any X" all
# mean the same thing. Reproduced live: "how many open cases" matched and
# answered correctly, but "do we have any open case" (same question,
# different phrasing) fell all the way through to the LLM classifier
# fallback, which at the time had no "status" field at all for cases and
# silently answered with the unfiltered total instead - fixed generally
# in both layers (this shared prefix here, and case_status in the
# classifier schema/prompt above).
_COUNT_PREFIX = r"(?:how many|do (?:we|i|you) have (?:any|some)?|is there (?:an?|any)?|are there (?:any)?)"

# Synonyms for the same underlying case status - "classify by meaning, not
# exact wording": active/ongoing/pending/in-progress/still-open all mean
# "open"; disposed/finished/resolved/archived/completed/done all mean
# "closed". Used as a fast regex pre-filter for the most common phrasings
# of these - the LLM classifier fallback (see groq_client.py's
# _META_CLASSIFIER_PROMPT) is what guarantees correctness for any OTHER
# phrasing this fixed word list doesn't anticipate.
_OPEN_STATUS_WORDS = r"open|active|ongoing|pending|in.progress|still open|not (?:yet )?closed"
_CLOSED_STATUS_WORDS = r"closed|disposed|finished|resolved|archived|completed|done"

STATS_PATTERNS = [
    # --- cases: breakdowns first (most specific), then filtered/typed
    # counts, then plain list/total ---
    (
        "cases",
        re.compile(r"\bcases\b.*\b(?:by|per)\s+lawyer\b", re.I),
        lambda firm: _cases_breakdown(firm, "lawyer"),
    ),
    (
        "cases",
        re.compile(r"\bcases\b.*\b(?:by|per)\s+status\b", re.I),
        lambda firm: _cases_breakdown(firm, "status"),
    ),
    (
        "cases",
        re.compile(r"\bcases\b.*\b(?:by|per)\s+client\b", re.I),
        lambda firm: _cases_breakdown(firm, "client"),
    ),
    (
        "cases",
        re.compile(
            r"\b(categorize|categorise|categorization|categorisation|group|breakdown|break\s*down)\b.*\bcases\b"
            r"|\bcases\b.*\b(categorized|categorised|grouped|broken down)\b"
            r"|\bcases\b.*\bby\s+(category|type)\b"
            r"|\bcase(s)?\s+distribution\b"
            rf"|\b{_COUNT_PREFIX} cases (of )?each\s+(type|category)\b",
            re.I,
        ),
        lambda firm: _cases_breakdown(firm, "category"),
    ),
    (
        # Order-independent (lookahead) rather than requiring "open cases"
        # word order strictly - reproduced live: "how many cases ARE open"
        # (status word AFTER "cases", a completely natural English
        # phrasing) didn't match a pattern requiring "open" immediately
        # before "cases", and silently fell through to the unfiltered
        # total instead.
        "cases",
        re.compile(rf"{_COUNT_PREFIX}(?=.*\bcases?\b)(?=.*\b(?:{_OPEN_STATUS_WORDS})\b)", re.I),
        lambda firm: f"You have {_open_cases(firm)} open case(s).",
    ),
    (
        "cases",
        re.compile(rf"{_COUNT_PREFIX}(?=.*\bcases?\b)(?=.*\b(?:{_CLOSED_STATUS_WORDS})\b)", re.I),
        lambda firm: f"You have {_case_count_filtered(firm, status='closed')} closed case(s).",
    ),
    *[
        (
            "cases",
            re.compile(rf"{_COUNT_PREFIX}(?=.*\bcases?\b)(?=.*\b{case_type}\b)", re.I),
            lambda firm, ct=case_type: f"You have {_cases_by_type(firm, ct)} {ct} case(s).",
        )
        for case_type in ("civil", "criminal", "corporate", "family", "property")
    ],
    (
        "cases",
        re.compile(
            r"\bcases\b.*\b(without|no|unassigned|no assigned)\b.*\blawyer"
            r"|\bunassigned\s+cases\b",
            re.I,
        ),
        lambda firm: _list_preview(_unassigned_case_titles(firm), "unassigned case"),
    ),
    (
        # Order-independent for the same reason as the count patterns above
        # - "list the cases that are open" is as natural as "list open
        # cases".
        "cases",
        re.compile(rf"\b(list|what are|show( me)?)\b(?=.*\bcases?\b)(?=.*\b(?:{_OPEN_STATUS_WORDS})\b)", re.I),
        lambda firm: _list_preview(_open_case_titles(firm), "open case"),
    ),
    (
        "cases",
        re.compile(rf"\b(list|what are|show( me)?)\b(?=.*\bcases?\b)(?=.*\b(?:{_CLOSED_STATUS_WORDS})\b)", re.I),
        lambda firm: _list_preview(_case_titles_by_status(firm, "closed"), "closed case"),
    ),
    *[
        (
            "cases",
            re.compile(rf"\b(list|what are|show( me)?)\b(?=.*\bcases?\b)(?=.*\b{case_type}\b)", re.I),
            lambda firm, ct=case_type: _list_preview(_case_titles_by_type(firm, ct), f"{ct} case"),
        )
        for case_type in ("civil", "criminal", "corporate", "family", "property")
    ],
    (
        "cases",
        re.compile(r"\b(list|what are|show( me)?)\b.*\bcases?\b", re.I),
        lambda firm: _list_preview(_case_titles(firm), "case"),
    ),
    (
        "cases",
        re.compile(rf"{_COUNT_PREFIX}\s+(total\s+)?(cases?|(?:legal\s+)?matters?|records?)\b", re.I),
        lambda firm: f"You have {_total_cases(firm)} case(s) in total.",
    ),
    # --- documents ---
    (
        "documents",
        re.compile(r"\b(list|what are|show( me)?)\b.*\b(documents|files|uploads)\b", re.I),
        lambda firm: _list_preview(_document_names(firm), "document"),
    ),
    (
        "documents",
        re.compile(rf"{_COUNT_PREFIX}\s+(documents|files|uploads)", re.I),
        lambda firm: f"You have {_total_documents(firm)} document(s) uploaded.",
    ),
    # --- reminders ---
    (
        "reminders",
        re.compile(r"\b(list|what are|show( me)?)\b.*\boverdue\b.*\breminders\b", re.I),
        lambda firm: _list_preview(_overdue_reminder_titles(firm), "overdue reminder"),
    ),
    (
        "reminders",
        re.compile(rf"{_COUNT_PREFIX}\s+overdue\s+reminders?\b", re.I),
        lambda firm: f"You have {_overdue_reminders(firm)} overdue reminder(s).",
    ),
    (
        "reminders",
        re.compile(r"\b(list|what are|show( me)?)\b.*\breminders\b", re.I),
        lambda firm: _list_preview(_open_reminder_titles(firm), "open reminder"),
    ),
    (
        "reminders",
        re.compile(rf"{_COUNT_PREFIX}\s+(open|pending)\s+reminders?\b", re.I),
        lambda firm: f"You have {_open_reminders(firm)} open reminder(s).",
    ),
    (
        "reminders",
        re.compile(rf"{_COUNT_PREFIX}\s+reminders?\b", re.I),
        lambda firm: f"You have {_open_reminders(firm)} open reminder(s).",
    ),
    # --- lawyers ---
    (
        "lawyers",
        re.compile(
            r"\b(list|who (is|are)|what are|show( me)?)\b(?!.*\bcases\b).*\b(lawyers|team|staff|employees)\b",
            re.I,
        ),
        lambda firm: _list_preview(_lawyer_names(firm), "lawyer"),
    ),
    (
        "lawyers",
        re.compile(rf"{_COUNT_PREFIX}\s+(lawyers|employees|team members|staff)", re.I),
        lambda firm: f"Your firm has {_total_lawyers(firm)} lawyer(s).",
    ),
    # --- drafts ---
    (
        "drafts",
        re.compile(r"\b(list|what are|show( me)?)\b.*\bdrafts\b", re.I),
        lambda firm: _list_preview(_draft_titles(firm), "draft"),
    ),
    (
        "drafts",
        re.compile(rf"{_COUNT_PREFIX}\s+drafts?\b", re.I),
        lambda firm: f"You have {_total_drafts(firm)} draft(s).",
    ),
    # --- contacts --- ("client(s)" is the natural way a lawyer refers to
    # these too, not just "contacts" - both map to the same entity.
    (
        "contacts",
        re.compile(r"\b(list|who (is|are)|what are|show( me)?)\b.*\b(contacts|clients)\b", re.I),
        lambda firm: _list_preview(_contact_names(firm), "contact"),
    ),
    (
        "contacts",
        re.compile(rf"{_COUNT_PREFIX}\s+(contacts?|clients?)\b", re.I),
        lambda firm: f"You have {_total_contacts(firm)} contact(s).",
    ),
    # --- drive ---
    (
        "drive",
        re.compile(r"\b(what|which|list)\b.*\bdrive\b|\bdrive\b.*\b(connected|synced|linked)\b", re.I),
        lambda firm: _drive_summary(firm),
    ),
]


def _dispatch_meta_question(classification: dict, firm) -> Optional[str]:
    """Runs the DB query matching an LLM classification of a meta question.
    The actual numbers/names always come straight from the database here -
    the LLM's only job upstream was deciding *which* query to run, never
    producing the answer itself, so results can't be hallucinated."""

    entity = classification.get("entity")
    aggregation = classification.get("aggregation", "count")
    case_type = classification.get("case_type")
    case_status = classification.get("case_status")
    reminder_filter = classification.get("reminder_filter")
    group_by = classification.get("group_by")

    if entity == "cases":
        if aggregation == "breakdown":
            return _cases_breakdown(firm, group_by or "category")

        valid_case_type = case_type if case_type in ("civil", "criminal", "corporate", "family", "property") else None
        valid_case_status = case_status if case_status in ("open", "closed", "in_progress", "on_hold") else None

        # Handles type, status, both together ("open property cases"), or
        # neither - a "how many open cases"/"do we have any closed cases"
        # phrasing the regex fast-path didn't anticipate should still come
        # back correctly filtered, not silently answered with the
        # unfiltered total, once it reaches this LLM-classified fallback.
        if aggregation == "list":
            label = _filtered_case_label(valid_case_type, valid_case_status)
            return _list_preview(_case_titles_filtered(firm, valid_case_type, valid_case_status), label)

        if valid_case_type or valid_case_status:
            label = _filtered_case_label(valid_case_type, valid_case_status)
            return f"You have {_case_count_filtered(firm, valid_case_type, valid_case_status)} {label}(s)."

        return f"You have {_total_cases(firm)} case(s) in total."

    if entity == "documents":
        if aggregation == "list":
            return _list_preview(_document_names(firm), "document")
        return f"You have {_total_documents(firm)} document(s) uploaded."

    if entity == "lawyers":
        if aggregation == "list":
            return _list_preview(_lawyer_names(firm), "lawyer")
        return f"Your firm has {_total_lawyers(firm)} lawyer(s)."

    if entity == "drafts":
        if aggregation == "list":
            return _list_preview(_draft_titles(firm), "draft")
        return f"You have {_total_drafts(firm)} draft(s)."

    if entity == "contacts":
        if aggregation == "list":
            return _list_preview(_contact_names(firm), "contact")
        return f"You have {_total_contacts(firm)} contact(s)."

    if entity == "reminders":
        if reminder_filter == "overdue":
            return (
                _list_preview(_overdue_reminder_titles(firm), "overdue reminder")
                if aggregation == "list"
                else f"You have {_overdue_reminders(firm)} overdue reminder(s)."
            )
        return (
            _list_preview(_open_reminder_titles(firm), "open reminder")
            if aggregation == "list"
            else f"You have {_open_reminders(firm)} open reminder(s)."
        )

    if entity == "drive":
        return _drive_summary(firm)

    return None


_ASSIGNED_TO_LAWYER_RE = re.compile(
    r"\bcases\b.*\bassigned\s+to\s+([a-zA-Z][\w .'\-]{1,60}?)\s*[\?\.!]?$", re.I
)

# A bare collection-pronoun follow-up ("what are they?", "show them",
# "list them", "which ones?") after a firm-stats answer that mentioned a
# count or list of something (documents, cases, lawyers, ...) - the
# collection equivalent of the single-case follow-up rule below (one
# case vs. one collection of records, same underlying "don't lose
# conversation context" problem).
_COLLECTION_PRONOUN_RE = re.compile(
    r"^\s*(?:what|who|which)\s+(?:are|were)\s+(?:they|them|those|these)\b"
    r"|^\s*(?:they|them|those|these)\s*[\?\.!]*\s*$"
    r"|\b(?:show|list|explain|summarize|describe|open)\s+(?:them|those|these)\b"
    r"|\btell me (?:about|more about)\s+(?:them|those|these)\b"
    r"|\bcan i see (?:them|those|these)\b"
    r"|\bwhich ones\b",
    re.I,
)


def _resolve_collection_followup(question: str, history) -> Optional[str]:
    """
    "How many documents do we have?" -> "You have 2 documents uploaded."
    -> "What are they?" should list those same 2 documents, not be
    treated as a brand-new, unresolvable search. Detects a bare
    they/them/those/these-style follow-up and rewrites it into an
    explicit LIST request reusing the most recent prior user question's
    own entity/filters (e.g. "how many open cases" -> "list open cases"),
    so it flows through the exact same, already-correct list-handling in
    try_answer_firm_stats below - no separate dispatch logic needed. This
    is purely an internal rewrite for the stats lookup; the user's actual
    original message is still what gets stored/shown.
    """
    if not history:
        return None
    if not _COLLECTION_PRONOUN_RE.search(question.strip()):
        return None

    prior_question = (history[-1].get("question") or "").strip()
    if not prior_question:
        return None

    # Already a list-style question ("list my documents") - reuse as-is.
    if re.search(r"\b(list|what are|show( me)?)\b", prior_question, re.I):
        return prior_question

    rewritten = re.sub(rf"^{_COUNT_PREFIX}\s*", "list ", prior_question, flags=re.I)
    return rewritten if rewritten != prior_question else None


def _resolve_single_case_id(firm, case_type: Optional[str] = None, case_status: Optional[str] = None):
    """
    Returns the case's id if these filters (or no filters at all, meaning
    the whole firm) narrow down to EXACTLY one case, else None. Powers the
    "single result rule" for conversation follow-ups - e.g. "how many open
    cases" resolving to exactly one case means a follow-up like "what is
    it about?" can be answered without asking the user to repeat the
    case's name, because the ONE case just discussed is now known, not
    re-guessed from raw conversation text each turn.
    """
    qs = _cases_filtered_queryset(firm, case_type, case_status)
    if qs.count() == 1:
        return qs.first().id
    return None


def _detect_case_filters_from_text(question: str):
    """
    Best-effort re-detection of case_type/case_status directly from the
    question text - used only to resolve which case(s) a cases-related
    answer produced by the regex fast-path was about, independent of
    which specific STATS_PATTERNS handler actually fired (those return
    plain answer strings, not structured filters).
    """
    lowered = question.lower()

    case_status = None
    if re.search(rf"\b(?:{_CLOSED_STATUS_WORDS})\b", lowered):
        case_status = "closed"
    elif re.search(rf"\b(?:{_OPEN_STATUS_WORDS})\b", lowered):
        case_status = "open"

    case_type = None
    for candidate in ("civil", "criminal", "corporate", "family", "property"):
        if re.search(rf"\b{candidate}\b", lowered):
            case_type = candidate
            break

    return case_type, case_status


def try_answer_firm_stats(question: str, firm):
    """
    Answers operational questions about the firm's own data (case/document
    /lawyer/draft/contact/reminder/drive counts, listings, and breakdowns)
    straight from the database - never hallucinated. Two layers:

    1. A fast regex pre-filter for the most common English phrasings -
       cheap, no LLM round-trip. Patterns are grouped by entity (cases,
       documents, reminders, ...) and only the single most specific match
       within each group fires, so a question can combine answers across
       DIFFERENT entities ("how many cases and documents") without two
       patterns for the SAME entity ever both firing and contradicting
       each other.
    2. An LLM intent classifier as the general fallback, so any phrasing,
       new aggregation, or language asking about the firm's own data is
       still caught, not just the ones anticipated by the patterns above.

    Returns (None, None) if the question isn't a meta question at all, so
    the caller falls through to document/web search. Otherwise returns
    (answer_text, resolved_case_id) - resolved_case_id is set only when
    this was a cases-related question that narrowed down to EXACTLY one
    case (see _resolve_single_case_id), so the caller can remember "the
    case we just discussed" for follow-up questions - the "single result
    rule".
    """
    stripped = question.strip()

    answers = []
    matched_groups = set()

    resolved_case_id = None

    # "cases assigned to <name>" needs the matched name text itself, which
    # the (group, pattern, handler(firm)) shape above can't carry through -
    # handled here as its own pre-check instead of forcing every handler in
    # STATS_PATTERNS to accept a match object it doesn't need.
    assigned_match = _ASSIGNED_TO_LAWYER_RE.search(stripped)
    if assigned_match:
        lawyer_name = assigned_match.group(1).strip()
        titles, ambiguous_names = _case_titles_by_lawyer_name(firm, lawyer_name)
        if ambiguous_names:
            answers.append(
                f"More than one lawyer on your team matches \"{lawyer_name}\": "
                f"{', '.join(ambiguous_names)}. Could you specify which one?"
            )
        elif titles is None:
            answers.append(f"I couldn't find a lawyer matching \"{lawyer_name}\" on your team.")
        else:
            answers.append(_list_preview(titles, f"case assigned to {lawyer_name}"))
            if len(titles) == 1:
                from cases.models import Case
                matched_case = Case.objects.filter(firm=firm, title=titles[0]).values_list("id", flat=True).first()
                resolved_case_id = matched_case
        matched_groups.add("cases")

    for group, pattern, handler in STATS_PATTERNS:
        if group in matched_groups:
            continue
        if pattern.search(stripped):
            answers.append(handler(firm))
            matched_groups.add(group)

    if answers:
        is_cases_query = "cases" in matched_groups
        if is_cases_query and resolved_case_id is None:
            case_type, case_status = _detect_case_filters_from_text(stripped)
            resolved_case_id = _resolve_single_case_id(firm, case_type, case_status)
        return " ".join(answers), resolved_case_id, is_cases_query

    from .groq_client import classify_meta_question

    classification = classify_meta_question(stripped)
    if classification is None:
        return None, None, False

    answer = _dispatch_meta_question(classification, firm)
    is_cases_query = classification.get("entity") == "cases"

    if answer is not None and is_cases_query:
        raw_type = classification.get("case_type")
        raw_status = classification.get("case_status")
        valid_type = raw_type if raw_type in ("civil", "criminal", "corporate", "family", "property") else None
        valid_status = raw_status if raw_status in ("open", "closed", "in_progress", "on_hold") else None
        resolved_case_id = _resolve_single_case_id(firm, valid_type, valid_status)

    return answer, resolved_case_id, is_cases_query
