import csv
import io
from datetime import datetime
from typing import List, Optional

from django.utils import timezone
from ninja import File, Router, Schema
from ninja.files import UploadedFile

from accounts.audit import log_audit_event
from accounts.auth import JWTAuth
from accounts.models import LawyerProfile
from accounts.permissions import require_permission
from .models import Case, CaseActivity, Contact, Reminder

case_router = Router(auth=JWTAuth())
reminder_router = Router(auth=JWTAuth())
dashboard_router = Router(auth=JWTAuth())
contact_router = Router(auth=JWTAuth())


class ErrorSchema(Schema):
    error: str


# ---------------------------------------------------------------------------
# Cases
# ---------------------------------------------------------------------------


class CaseCreateSchema(Schema):
    title: str
    case_type: str = "other"
    status: str = "open"
    description: str = ""
    client_name: str = ""
    drive_link: str = ""
    assigned_lawyer_ids: List[int] = []


class CaseUpdateSchema(Schema):
    title: Optional[str] = None
    case_type: Optional[str] = None
    status: Optional[str] = None
    description: Optional[str] = None
    client_name: Optional[str] = None
    drive_link: Optional[str] = None
    assigned_lawyer_ids: Optional[List[int]] = None


class CaseListItemSchema(Schema):
    id: int
    title: str
    case_type: str
    status: str
    client_name: str
    assigned_lawyer_names: List[str]
    reminders_count: int
    open_reminders_count: int
    created_at: datetime
    updated_at: datetime


class ReminderSchema(Schema):
    id: int
    title: str
    notes: str
    due_date: datetime
    is_completed: bool
    completed_at: Optional[datetime] = None


class DocumentRefSchema(Schema):
    document_id: str
    file_name: str


class CaseDetailSchema(Schema):
    id: int
    title: str
    case_type: str
    status: str
    description: str
    client_name: str
    drive_link: str
    assigned_lawyer_names: List[str]
    documents: List[DocumentRefSchema]
    reminders: List[ReminderSchema]
    created_at: datetime
    updated_at: datetime


def _log_activity(case: Case, actor: LawyerProfile, activity_type: str, body: str = "") -> None:
    CaseActivity.objects.create(case=case, actor=actor, activity_type=activity_type, body=body)


def _serialize_case_list_item(case: Case) -> dict:
    return {
        "id": case.id,
        "title": case.title,
        "case_type": case.case_type,
        "status": case.status,
        "client_name": case.client_name,
        "assigned_lawyer_names": [
            lawyer.user.get_full_name() or lawyer.user.username
            for lawyer in case.assigned_lawyers.all()
        ],
        "reminders_count": case.reminders.count(),
        "open_reminders_count": case.reminders.filter(is_completed=False).count(),
        "created_at": case.created_at,
        "updated_at": case.updated_at,
    }


def _serialize_case_detail(case: Case) -> dict:
    return {
        "id": case.id,
        "title": case.title,
        "case_type": case.case_type,
        "status": case.status,
        "description": case.description,
        "client_name": case.client_name,
        "drive_link": case.drive_link,
        "assigned_lawyer_names": [
            lawyer.user.get_full_name() or lawyer.user.username
            for lawyer in case.assigned_lawyers.all()
        ],
        "documents": [
            {"document_id": str(document.document_id), "file_name": document.original_name}
            for document in case.documents.all()
        ],
        "reminders": [
            {
                "id": reminder.id,
                "title": reminder.title,
                "notes": reminder.notes,
                "due_date": reminder.due_date,
                "is_completed": reminder.is_completed,
                "completed_at": reminder.completed_at,
            }
            for reminder in case.reminders.all().order_by("due_date")
        ],
        "created_at": case.created_at,
        "updated_at": case.updated_at,
    }


@case_router.get("/", response={200: List[CaseListItemSchema]})
def list_cases(request, status: Optional[str] = None, case_type: Optional[str] = None):
    cases = Case.objects.filter(firm=request.auth.firm).prefetch_related("assigned_lawyers__user")

    if status:
        cases = cases.filter(status=status)

    if case_type:
        cases = cases.filter(case_type=case_type)

    return [_serialize_case_list_item(case) for case in cases.order_by("-updated_at")]


@case_router.post("/", response={201: CaseDetailSchema, 400: ErrorSchema, 403: ErrorSchema})
def create_case(request, payload: CaseCreateSchema):
    denied = require_permission(request, "create_case")
    if denied:
        return denied

    profile: LawyerProfile = request.auth

    case = Case.objects.create(
        firm=profile.firm,
        title=payload.title,
        case_type=payload.case_type,
        status=payload.status,
        description=payload.description,
        client_name=payload.client_name,
        drive_link=payload.drive_link,
        created_by=profile,
    )

    lawyer_ids = set(payload.assigned_lawyer_ids) | {profile.id}
    lawyers = LawyerProfile.objects.filter(id__in=lawyer_ids, firm=profile.firm)
    case.assigned_lawyers.set(lawyers)

    _log_activity(case, profile, "case_created", f"{profile.user.get_full_name() or profile.user.username} created this case.")

    return 201, _serialize_case_detail(case)


@case_router.get("/{case_id}/", response={200: CaseDetailSchema, 404: ErrorSchema})
def get_case(request, case_id: int):
    try:
        case = Case.objects.prefetch_related(
            "assigned_lawyers__user", "documents", "reminders"
        ).get(id=case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 404, {"error": "Case not found."}

    return 200, _serialize_case_detail(case)


@case_router.patch(
    "/{case_id}/", response={200: CaseDetailSchema, 403: ErrorSchema, 404: ErrorSchema}
)
def update_case(request, case_id: int, payload: CaseUpdateSchema):
    denied = require_permission(request, "edit_case")
    if denied:
        return denied

    try:
        case = Case.objects.get(id=case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 404, {"error": "Case not found."}

    data = payload.dict(exclude_unset=True, exclude={"assigned_lawyer_ids"})
    previous_status = case.status

    for field, value in data.items():
        setattr(case, field, value)

    case.save()

    if "status" in data and data["status"] != previous_status:
        _log_activity(
            case, request.auth, "status_changed",
            f"Status changed from {previous_status} to {case.status}.",
        )

    if payload.assigned_lawyer_ids is not None:
        lawyers = LawyerProfile.objects.filter(
            id__in=payload.assigned_lawyer_ids, firm=case.firm
        )
        case.assigned_lawyers.set(lawyers)
        _log_activity(case, request.auth, "lawyers_updated", "Assigned lawyers updated.")

    return 200, _serialize_case_detail(case)


@case_router.delete("/{case_id}/", response={204: None, 403: ErrorSchema, 404: ErrorSchema})
def delete_case(request, case_id: int):
    denied = require_permission(request, "delete_case")
    if denied:
        return denied

    try:
        case = Case.objects.get(id=case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 404, {"error": "Case not found."}

    case_title = case.title
    case.delete()
    log_audit_event(request.auth.firm, request.auth, "case_deleted", case_title)

    return 204, None


# ---------------------------------------------------------------------------
# Case activity feed (comments + auto-logged events)
# ---------------------------------------------------------------------------


class CaseActivitySchema(Schema):
    id: int
    activity_type: str
    body: str
    actor_name: Optional[str] = None
    created_at: datetime


class CommentCreateSchema(Schema):
    body: str


def _serialize_activity(activity: CaseActivity) -> dict:
    return {
        "id": activity.id,
        "activity_type": activity.activity_type,
        "body": activity.body,
        "actor_name": (
            activity.actor.user.get_full_name() or activity.actor.user.username
            if activity.actor
            else None
        ),
        "created_at": activity.created_at,
    }


@case_router.get(
    "/{case_id}/activities/",
    response={200: List[CaseActivitySchema], 404: ErrorSchema},
)
def list_case_activities(request, case_id: int):
    try:
        case = Case.objects.get(id=case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 404, {"error": "Case not found."}

    activities = case.activities.select_related("actor__user").order_by("created_at")

    return 200, [_serialize_activity(activity) for activity in activities]


@case_router.post(
    "/{case_id}/activities/",
    response={201: CaseActivitySchema, 404: ErrorSchema},
)
def post_case_comment(request, case_id: int, payload: CommentCreateSchema):
    try:
        case = Case.objects.get(id=case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 404, {"error": "Case not found."}

    activity = CaseActivity.objects.create(
        case=case,
        actor=request.auth,
        activity_type="comment",
        body=payload.body,
    )

    return 201, _serialize_activity(activity)


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------


class ReminderCreateSchema(Schema):
    case_id: int
    title: str
    notes: str = ""
    due_date: datetime


class ReminderListItemSchema(Schema):
    id: int
    case_id: int
    case_title: str
    title: str
    notes: str
    due_date: datetime
    is_completed: bool
    completed_at: Optional[datetime] = None


def _serialize_reminder(reminder: Reminder) -> dict:
    return {
        "id": reminder.id,
        "case_id": reminder.case_id,
        "case_title": reminder.case.title,
        "title": reminder.title,
        "notes": reminder.notes,
        "due_date": reminder.due_date,
        "is_completed": reminder.is_completed,
        "completed_at": reminder.completed_at,
    }


@reminder_router.get("/", response={200: List[ReminderListItemSchema]})
def list_reminders(
    request,
    case_id: Optional[int] = None,
    upcoming: bool = False,
    overdue: bool = False,
):
    reminders = Reminder.objects.filter(case__firm=request.auth.firm).select_related("case")

    if case_id:
        reminders = reminders.filter(case_id=case_id)

    now = timezone.now()

    if upcoming:
        reminders = reminders.filter(is_completed=False, due_date__gte=now)

    if overdue:
        reminders = reminders.filter(is_completed=False, due_date__lt=now)

    return [_serialize_reminder(reminder) for reminder in reminders.order_by("due_date")]


@reminder_router.post("/", response={201: ReminderListItemSchema, 400: ErrorSchema})
def create_reminder(request, payload: ReminderCreateSchema):
    try:
        case = Case.objects.get(id=payload.case_id, firm=request.auth.firm)
    except Case.DoesNotExist:
        return 400, {"error": "Case not found for this firm."}

    reminder = Reminder.objects.create(
        case=case,
        title=payload.title,
        notes=payload.notes,
        due_date=payload.due_date,
        created_by=request.auth,
    )

    _log_activity(case, request.auth, "reminder_added", f"Reminder added: {reminder.title}")

    return 201, _serialize_reminder(reminder)


@reminder_router.patch(
    "/{reminder_id}/complete/",
    response={200: ReminderListItemSchema, 404: ErrorSchema},
)
def complete_reminder(request, reminder_id: int):
    try:
        reminder = Reminder.objects.select_related("case").get(
            id=reminder_id, case__firm=request.auth.firm
        )
    except Reminder.DoesNotExist:
        return 404, {"error": "Reminder not found."}

    reminder.is_completed = True
    reminder.completed_at = timezone.now()
    reminder.save()

    _log_activity(reminder.case, request.auth, "reminder_completed", f"Reminder completed: {reminder.title}")

    return 200, _serialize_reminder(reminder)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


class DashboardSummarySchema(Schema):
    case_counts_by_status: dict
    total_cases: int
    upcoming_reminders: List[ReminderListItemSchema]
    overdue_reminders: List[ReminderListItemSchema]
    recent_cases: List[CaseListItemSchema]


@dashboard_router.get("/summary/", response={200: DashboardSummarySchema})
def dashboard_summary(request):
    firm = request.auth.firm
    now = timezone.now()

    cases = Case.objects.filter(firm=firm)

    case_counts_by_status = {
        choice: cases.filter(status=choice).count()
        for choice, _ in Case.STATUS_CHOICES
    }

    reminders = Reminder.objects.filter(case__firm=firm, is_completed=False).select_related("case")

    upcoming_reminders = reminders.filter(due_date__gte=now).order_by("due_date")[:10]
    overdue_reminders = reminders.filter(due_date__lt=now).order_by("due_date")

    recent_cases = cases.prefetch_related("assigned_lawyers__user").order_by("-updated_at")[:5]

    return 200, {
        "case_counts_by_status": case_counts_by_status,
        "total_cases": cases.count(),
        "upcoming_reminders": [_serialize_reminder(reminder) for reminder in upcoming_reminders],
        "overdue_reminders": [_serialize_reminder(reminder) for reminder in overdue_reminders],
        "recent_cases": [_serialize_case_list_item(case) for case in recent_cases],
    }


# ---------------------------------------------------------------------------
# Contacts (manual entry + CSV import)
# ---------------------------------------------------------------------------


class ContactCreateSchema(Schema):
    name: str
    email: str = ""
    phone: str = ""
    notes: str = ""
    case_id: Optional[int] = None


class ContactUpdateSchema(Schema):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    case_id: Optional[int] = None


class ContactSchema(Schema):
    id: int
    name: str
    email: str
    phone: str
    notes: str
    case_id: Optional[int] = None
    case_title: Optional[str] = None
    created_at: datetime


class ContactImportResultSchema(Schema):
    created: int
    skipped: int
    errors: List[str]


def _serialize_contact(contact: Contact) -> dict:
    return {
        "id": contact.id,
        "name": contact.name,
        "email": contact.email,
        "phone": contact.phone,
        "notes": contact.notes,
        "case_id": contact.case_id,
        "case_title": contact.case.title if contact.case_id else None,
        "created_at": contact.created_at,
    }


@contact_router.get("/", response={200: List[ContactSchema]})
def list_contacts(request, case_id: Optional[int] = None):
    contacts = Contact.objects.filter(firm=request.auth.firm).select_related("case")

    if case_id:
        contacts = contacts.filter(case_id=case_id)

    return [_serialize_contact(contact) for contact in contacts.order_by("name")]


@contact_router.post("/", response={201: ContactSchema, 400: ErrorSchema, 403: ErrorSchema})
def create_contact(request, payload: ContactCreateSchema):
    denied = require_permission(request, "manage_contacts")
    if denied:
        return denied

    if not payload.name.strip():
        return 400, {"error": "Contact name is required."}

    case = None

    if payload.case_id:
        try:
            case = Case.objects.get(id=payload.case_id, firm=request.auth.firm)
        except Case.DoesNotExist:
            return 400, {"error": "Case not found for this firm."}

    contact = Contact.objects.create(
        firm=request.auth.firm,
        case=case,
        name=payload.name.strip(),
        email=payload.email.strip(),
        phone=payload.phone.strip(),
        notes=payload.notes,
        created_by=request.auth,
    )

    return 201, _serialize_contact(contact)


# NOTE: /import/ (literal) must be registered before /{contact_id}/ (dynamic)
# below - Django resolves URL patterns in registration order, and a dynamic
# path would otherwise greedily capture "import" as a contact_id (same class
# of bug documented in drafts/api.py).


@contact_router.post(
    "/import/",
    response={200: ContactImportResultSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def import_contacts_csv(request, file: UploadedFile = File(...)):
    denied = require_permission(request, "manage_contacts")
    if denied:
        return denied

    try:
        raw_text = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return 400, {"error": "Could not read file. Please upload a UTF-8 encoded CSV."}

    reader = csv.DictReader(io.StringIO(raw_text))
    fields = {(name or "").strip().lower(): name for name in (reader.fieldnames or [])}

    if "name" not in fields:
        return 400, {"error": "CSV must include a 'name' column (email, phone, notes are optional)."}

    created = 0
    skipped = 0
    errors: List[str] = []

    for row_number, row in enumerate(reader, start=2):
        name = (row.get(fields["name"]) or "").strip()

        if not name:
            skipped += 1
            errors.append(f"Row {row_number}: missing name, skipped.")
            continue

        Contact.objects.create(
            firm=request.auth.firm,
            name=name,
            email=(row.get(fields.get("email", ""), "") or "").strip(),
            phone=(row.get(fields.get("phone", ""), "") or "").strip(),
            notes=(row.get(fields.get("notes", ""), "") or "").strip(),
            created_by=request.auth,
        )
        created += 1

    return 200, {"created": created, "skipped": skipped, "errors": errors[:20]}


@contact_router.patch(
    "/{contact_id}/",
    response={200: ContactSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def update_contact(request, contact_id: int, payload: ContactUpdateSchema):
    denied = require_permission(request, "manage_contacts")
    if denied:
        return denied

    try:
        contact = Contact.objects.get(id=contact_id, firm=request.auth.firm)
    except Contact.DoesNotExist:
        return 404, {"error": "Contact not found."}

    data = payload.dict(exclude_unset=True, exclude={"case_id"})

    for field, value in data.items():
        setattr(contact, field, value)

    if "case_id" in payload.dict(exclude_unset=True):
        if payload.case_id is None:
            contact.case = None
        else:
            try:
                contact.case = Case.objects.get(id=payload.case_id, firm=request.auth.firm)
            except Case.DoesNotExist:
                return 400, {"error": "Case not found for this firm."}

    contact.save()

    return 200, _serialize_contact(contact)


@contact_router.delete("/{contact_id}/", response={204: None, 403: ErrorSchema, 404: ErrorSchema})
def delete_contact(request, contact_id: int):
    denied = require_permission(request, "manage_contacts")
    if denied:
        return denied

    try:
        contact = Contact.objects.get(id=contact_id, firm=request.auth.firm)
    except Contact.DoesNotExist:
        return 404, {"error": "Contact not found."}

    contact.delete()

    return 204, None
