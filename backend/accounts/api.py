import csv
import io
from datetime import datetime
from typing import List, Optional

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.utils import timezone
from django.utils.http import urlsafe_base64_decode
from django.utils.text import slugify
from ninja import File, Router, Schema
from ninja.files import UploadedFile
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .audit import log_audit_event
from .auth import JWTAuth
from .emails import build_invite_link, send_lawyer_invite_email
from .models import Firm, LawyerProfile
from .permissions import has_permission, require_permission
from .rate_limit import client_ip, rate_limit_exceeded
from cases.sample_data import seed_sample_documents

router = Router()
lawyer_router = Router(auth=JWTAuth())

# "public" is a role, but only ever assigned via the dedicated public
# self-registration flow (register_public below) - a real firm's admin
# must never be able to invite or promote someone into it.
FIRM_ASSIGNABLE_ROLES = ["admin", "partner", "associate", "paralegal"]


class LoginSchema(Schema):
    username: str
    password: str


class TokenResponseSchema(Schema):
    access: str
    refresh: str
    role: str
    firm_id: int
    firm_name: str
    firm_size: str
    full_name: str


class RefreshSchema(Schema):
    refresh: str


class RefreshResponseSchema(Schema):
    access: str


class MeResponseSchema(Schema):
    username: str
    full_name: str
    role: str
    firm_id: int
    firm_name: str
    firm_size: str


class ErrorSchema(Schema):
    error: str


def _record_login(profile) -> None:
    """
    Record a successful login so an admin can see when each team member last
    signed in (Team page) and the full sign-in history (Admin Dashboard audit
    feed). This JWT flow uses authenticate() directly, which - unlike Django's
    session login() - does NOT update User.last_login, so we set it ourselves.
    """
    user = profile.user
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    log_audit_event(profile.firm, profile, "logged_in")


@router.post("/login/", response={200: TokenResponseSchema, 401: ErrorSchema, 429: ErrorSchema})
def login(request, payload: LoginSchema):
    rate_key = f"login:{client_ip(request)}:{payload.username}"
    if rate_limit_exceeded(rate_key, limit=8, window_seconds=300):
        return 429, {"error": "Too many login attempts. Please try again in a few minutes."}

    identifier = payload.username.strip()
    username = identifier

    if "@" in identifier:
        # Login also accepts email, since invited lawyers are given a
        # username they didn't choose and may not remember - resolve it to
        # the underlying username before authenticating (Django's default
        # auth backend only checks USERNAME_FIELD, not email).
        matches = User.objects.filter(email__iexact=identifier)

        if matches.count() != 1:
            return 401, {"error": "Invalid credentials."}

        username = matches.first().username

    user = authenticate(request, username=username, password=payload.password)

    if user is None or not hasattr(user, "lawyer_profile"):
        return 401, {"error": "Invalid credentials."}

    profile = user.lawyer_profile

    if not profile.firm.is_active:
        return 401, {"error": "This firm's account has been suspended. Contact support."}

    _record_login(profile)

    refresh = RefreshToken.for_user(user)

    return 200, {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": profile.role,
        "firm_id": profile.firm_id,
        "firm_name": profile.firm.name,
        "firm_size": profile.firm.size,
        "full_name": user.get_full_name() or user.username,
    }


class RegisterSchema(Schema):
    username: str
    password: str
    email: str
    full_name: str = ""
    firm_name: Optional[str] = None
    firm_size: str = "solo"
    bar_registration_number: str = ""
    address: str = ""
    official_email_domain: str = ""
    practice_areas: str = ""
    employee_count: int = 0
    lawyer_count: int = 0
    office_locations: str = ""
    phone: str = ""
    website: str = ""
    gst_number: str = ""


def _unique_firm_slug(base: str) -> str:
    base_slug = slugify(base) or "individual"
    slug = base_slug
    suffix = 1

    while Firm.objects.filter(slug=slug).exists():
        suffix += 1
        slug = f"{base_slug}-{suffix}"

    return slug


@router.post("/register/", response={201: TokenResponseSchema, 400: ErrorSchema, 429: ErrorSchema})
def register(request, payload: RegisterSchema):
    rate_key = f"register:{client_ip(request)}"
    if rate_limit_exceeded(rate_key, limit=10, window_seconds=3600):
        return 429, {"error": "Too many signup attempts from this network. Please try again later."}

    if not payload.username or not payload.password or not payload.email:
        return 400, {"error": "Username, email, and password are required."}

    if len(payload.password) < 8:
        return 400, {"error": "Password must be at least 8 characters."}

    try:
        validate_email(payload.email)
    except ValidationError:
        return 400, {"error": "Please enter a valid email address."}

    if User.objects.filter(username=payload.username).exists():
        return 400, {"error": "A user with this username already exists."}

    if User.objects.filter(email__iexact=payload.email).exists():
        return 400, {
            "error": "This email is already associated with an account. "
            "A lawyer cannot belong to two firms with the same email."
        }

    display_name = payload.firm_name or payload.full_name or payload.username
    firm_label = payload.firm_name or f"{display_name} (Individual)"

    if Firm.objects.filter(name__iexact=firm_label).exists():
        return 400, {
            "error": "A firm with this name is already registered. Please choose a different firm name."
        }

    slug = _unique_firm_slug(display_name)
    firm_size = payload.firm_size if payload.firm_size in dict(Firm.SIZE_CHOICES) else "solo"

    firm = Firm.objects.create(
        name=firm_label,
        slug=slug,
        size=firm_size,
        bar_registration_number=payload.bar_registration_number,
        address=payload.address,
        official_email_domain=payload.official_email_domain,
        practice_areas=payload.practice_areas,
        employee_count=payload.employee_count,
        lawyer_count=payload.lawyer_count,
        office_locations=payload.office_locations,
        phone=payload.phone,
        website=payload.website,
        gst_number=payload.gst_number,
    )

    first_name, _, last_name = payload.full_name.partition(" ")
    user = User.objects.create_user(
        username=payload.username,
        password=payload.password,
        email=payload.email,
        first_name=first_name,
        last_name=last_name,
    )

    profile = LawyerProfile.objects.create(user=user, firm=firm, role="admin")
    refresh = RefreshToken.for_user(user)

    try:
        seed_sample_documents(firm, profile)
    except Exception:
        pass

    return 201, {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": profile.role,
        "firm_id": profile.firm_id,
        "firm_name": profile.firm.name,
        "firm_size": profile.firm.size,
        "full_name": user.get_full_name() or user.username,
    }


class RegisterPublicSchema(Schema):
    username: str
    password: str
    email: str
    full_name: str = ""


@router.post(
    "/register-public/", response={201: TokenResponseSchema, 400: ErrorSchema, 429: ErrorSchema}
)
def register_public(request, payload: RegisterPublicSchema):
    """
    Self-service signup for Public Users - a general visitor with no law
    firm affiliation. No firm details, no team, no sample documents.
    Gets an isolated pseudo-firm purely as a data-isolation container so
    the existing per-firm Chroma collection / RBAC infrastructure applies
    unchanged; this "firm" is never visible to or reachable from any real
    law firm, and the "public" role carries no team/case/draft/contact
    permissions (see ROLE_PERMISSIONS).
    """
    rate_key = f"register-public:{client_ip(request)}"
    if rate_limit_exceeded(rate_key, limit=10, window_seconds=3600):
        return 429, {"error": "Too many signup attempts from this network. Please try again later."}

    if not payload.username or not payload.password or not payload.email:
        return 400, {"error": "Username, email, and password are required."}

    if len(payload.password) < 8:
        return 400, {"error": "Password must be at least 8 characters."}

    try:
        validate_email(payload.email)
    except ValidationError:
        return 400, {"error": "Please enter a valid email address."}

    if User.objects.filter(username=payload.username).exists():
        return 400, {"error": "A user with this username already exists."}

    if User.objects.filter(email__iexact=payload.email).exists():
        return 400, {"error": "This email is already associated with an account."}

    display_name = payload.full_name or payload.username
    firm_label = f"{display_name} (Public)"

    unique_label = firm_label
    counter = 1
    while Firm.objects.filter(name__iexact=unique_label).exists():
        counter += 1
        unique_label = f"{firm_label} {counter}"

    firm = Firm.objects.create(
        name=unique_label,
        slug=_unique_firm_slug(f"public-{display_name}"),
        size="solo",
    )

    first_name, _, last_name = payload.full_name.partition(" ")
    user = User.objects.create_user(
        username=payload.username,
        password=payload.password,
        email=payload.email,
        first_name=first_name,
        last_name=last_name,
    )

    profile = LawyerProfile.objects.create(user=user, firm=firm, role="public")
    refresh = RefreshToken.for_user(user)

    return 201, {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": profile.role,
        "firm_id": profile.firm_id,
        "firm_name": profile.firm.name,
        "firm_size": profile.firm.size,
        "full_name": user.get_full_name() or user.username,
    }


class SetPasswordSchema(Schema):
    uid: str
    token: str
    password: str


@router.post("/set-password/", response={200: TokenResponseSchema, 400: ErrorSchema, 429: ErrorSchema})
def set_password(request, payload: SetPasswordSchema):
    """
    Completes a lawyer invite: validates the emailed uid/token, sets the
    lawyer's own password, and logs them straight in (same response shape
    as /login/) since this is the first time they can authenticate.
    """
    rate_key = f"set-password:{client_ip(request)}:{payload.uid}"
    if rate_limit_exceeded(rate_key, limit=10, window_seconds=300):
        return 429, {"error": "Too many attempts. Please try again in a few minutes."}

    if len(payload.password) < 8:
        return 400, {"error": "Password must be at least 8 characters."}

    try:
        user_id = urlsafe_base64_decode(payload.uid).decode()
        user = User.objects.get(pk=user_id)
    except (User.DoesNotExist, ValueError, TypeError, OverflowError):
        return 400, {"error": "Invalid or expired invite link."}

    if not default_token_generator.check_token(user, payload.token):
        return 400, {"error": "Invalid or expired invite link."}

    if not hasattr(user, "lawyer_profile"):
        return 400, {"error": "This account is not set up correctly."}

    profile = user.lawyer_profile

    if not profile.firm.is_active:
        return 400, {"error": "This firm's account has been suspended. Contact support."}

    user.set_password(payload.password)
    user.save()

    _record_login(profile)

    refresh = RefreshToken.for_user(user)

    return 200, {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
        "role": profile.role,
        "firm_id": profile.firm_id,
        "firm_name": profile.firm.name,
        "firm_size": profile.firm.size,
        "full_name": user.get_full_name() or user.username,
    }


@router.post("/refresh/", response={200: RefreshResponseSchema, 401: ErrorSchema})
def refresh_token(request, payload: RefreshSchema):
    try:
        refresh = RefreshToken(payload.refresh)
    except TokenError:
        return 401, {"error": "Invalid or expired refresh token."}

    return 200, {"access": str(refresh.access_token)}


@router.get("/me/", auth=JWTAuth(), response={200: MeResponseSchema})
def me(request):
    profile = request.auth

    return 200, {
        "username": profile.user.username,
        "full_name": profile.user.get_full_name() or profile.user.username,
        "role": profile.role,
        "firm_id": profile.firm_id,
        "firm_name": profile.firm.name,
        "firm_size": profile.firm.size,
    }


# ---------------------------------------------------------------------------
# Firm profile
# ---------------------------------------------------------------------------


class FirmProfileSchema(Schema):
    id: int
    name: str
    size: str
    bar_registration_number: str
    address: str
    official_email_domain: str
    practice_areas: str
    employee_count: int
    lawyer_count: int
    active_lawyer_count: int
    office_locations: str
    phone: str
    website: str
    gst_number: str
    logo_url: Optional[str] = None
    default_region: str


class FirmProfileUpdateSchema(Schema):
    name: Optional[str] = None
    size: Optional[str] = None
    bar_registration_number: Optional[str] = None
    address: Optional[str] = None
    official_email_domain: Optional[str] = None
    practice_areas: Optional[str] = None
    employee_count: Optional[int] = None
    lawyer_count: Optional[int] = None
    office_locations: Optional[str] = None
    phone: Optional[str] = None
    website: Optional[str] = None
    gst_number: Optional[str] = None
    default_region: Optional[str] = None


def _serialize_firm(firm: Firm) -> dict:
    return {
        "id": firm.id,
        "name": firm.name,
        "size": firm.size,
        "bar_registration_number": firm.bar_registration_number,
        "address": firm.address,
        "official_email_domain": firm.official_email_domain,
        "practice_areas": firm.practice_areas,
        "employee_count": firm.employee_count,
        "lawyer_count": firm.lawyer_count,
        "active_lawyer_count": firm.lawyers.filter(user__is_active=True).count(),
        "office_locations": firm.office_locations,
        "phone": firm.phone,
        "website": firm.website,
        "gst_number": firm.gst_number,
        "logo_url": firm.logo.url if firm.logo else None,
        "default_region": firm.default_region,
    }


@router.get("/firm/", auth=JWTAuth(), response={200: FirmProfileSchema})
def get_firm_profile(request):
    return 200, _serialize_firm(request.auth.firm)


@router.patch(
    "/firm/",
    auth=JWTAuth(),
    response={200: FirmProfileSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def update_firm_profile(request, payload: FirmProfileUpdateSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    firm = request.auth.firm
    data = payload.dict(exclude_unset=True)

    if "size" in data and data["size"] not in dict(Firm.SIZE_CHOICES):
        return 400, {"error": "Invalid firm size."}

    if "default_region" in data and data["default_region"] not in dict(Firm.REGION_CHOICES):
        return 400, {"error": "Invalid region."}

    for field, value in data.items():
        setattr(firm, field, value)

    firm.save()
    log_audit_event(firm, request.auth, "firm_profile_updated", ", ".join(data.keys()))

    return 200, _serialize_firm(firm)


@router.post(
    "/firm/logo/",
    auth=JWTAuth(),
    response={200: FirmProfileSchema, 403: ErrorSchema},
)
def upload_firm_logo(request, file: UploadedFile = File(...)):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    firm = request.auth.firm
    firm.logo = file
    firm.save()
    log_audit_event(firm, request.auth, "firm_logo_updated")

    return 200, _serialize_firm(firm)


# ---------------------------------------------------------------------------
# Lawyer management (admin-only for create/update)
# ---------------------------------------------------------------------------


class LawyerListItemSchema(Schema):
    id: int
    username: str
    full_name: str
    email: str
    role: str
    department: str
    is_active: bool
    invite_pending: bool
    last_login: Optional[datetime] = None


class LawyerCreateResponseSchema(LawyerListItemSchema):
    email_sent: bool
    invite_link: Optional[str] = None


class LawyerCreateSchema(Schema):
    username: str
    email: str
    first_name: str = ""
    last_name: str = ""
    role: str = "associate"
    department: str = ""


class LawyerUpdateSchema(Schema):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    department: Optional[str] = None
    successor_id: Optional[int] = None


class LawyerImportResultSchema(Schema):
    created: int
    skipped: int
    errors: List[str]


def _serialize_lawyer(profile: LawyerProfile, include_last_login: bool = True) -> dict:
    # last_login is a colleague's activity detail - only firm admins (the
    # "manage_team" capability) should see it, so it's omitted for everyone
    # else rather than leaked to the whole team via the list endpoint.
    return {
        "id": profile.id,
        "username": profile.user.username,
        "full_name": profile.user.get_full_name() or profile.user.username,
        "email": profile.user.email,
        "role": profile.role,
        "department": profile.department,
        "is_active": profile.user.is_active,
        "invite_pending": not profile.user.has_usable_password(),
        "last_login": profile.user.last_login if include_last_login else None,
    }


def _require_admin(request):
    return require_permission(request, "manage_team")


@lawyer_router.get("/", response={200: List[LawyerListItemSchema]})
def list_lawyers(request):
    can_see_last_login = has_permission(request.auth.role, "manage_team")
    profiles = LawyerProfile.objects.filter(firm=request.auth.firm).select_related("user")
    return [
        _serialize_lawyer(profile, include_last_login=can_see_last_login)
        for profile in profiles.order_by("user__username")
    ]


@lawyer_router.post("/", response={201: LawyerCreateResponseSchema, 400: ErrorSchema, 403: ErrorSchema})
def create_lawyer(request, payload: LawyerCreateSchema):
    denied = _require_admin(request)
    if denied:
        return denied

    if User.objects.filter(username=payload.username).exists():
        return 400, {"error": "A user with this username already exists."}

    if not payload.email:
        return 400, {"error": "Email is required to send the invite."}

    if User.objects.filter(email__iexact=payload.email).exists():
        return 400, {
            "error": "This email is already associated with an account at another firm. "
            "A lawyer cannot belong to two firms with the same email."
        }

    if payload.role not in FIRM_ASSIGNABLE_ROLES:
        return 400, {"error": "Invalid role."}

    if payload.role == "admin" and LawyerProfile.objects.filter(
        firm=request.auth.firm, role="admin"
    ).exists():
        return 400, {
            "error": "This firm already has an admin. Only one admin is allowed per firm - "
            "transfer the admin role instead of inviting a second admin."
        }

    user = User(
        username=payload.username,
        email=payload.email,
        first_name=payload.first_name,
        last_name=payload.last_name,
    )
    user.set_unusable_password()
    user.save()

    profile = LawyerProfile.objects.create(
        user=user,
        firm=request.auth.firm,
        role=payload.role,
        department=payload.department,
    )

    invite_link = build_invite_link(user)
    email_sent = True

    try:
        send_lawyer_invite_email(user, request.auth.firm.name)
    except Exception:
        email_sent = False

    log_audit_event(
        request.auth.firm, request.auth, "lawyer_invited",
        f"{payload.username} ({payload.role})",
    )

    result = _serialize_lawyer(profile)
    result["email_sent"] = email_sent
    result["invite_link"] = None if email_sent else invite_link

    return 201, result


# NOTE: /import/ (literal) must be registered before /{lawyer_id}/ (dynamic)
# below - same class of route-ordering issue documented in drafts/api.py
# and cases/api.py.


@lawyer_router.post(
    "/import/",
    response={200: LawyerImportResultSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def import_lawyers_csv(request, file: UploadedFile = File(...)):
    denied = _require_admin(request)
    if denied:
        return denied

    try:
        raw_text = file.read().decode("utf-8-sig")
    except UnicodeDecodeError:
        return 400, {"error": "Could not read file. Please upload a UTF-8 encoded CSV."}

    reader = csv.DictReader(io.StringIO(raw_text))
    fields = {(name or "").strip().lower(): name for name in (reader.fieldnames or [])}

    required = {"username", "email"}
    if not required.issubset(fields):
        return 400, {"error": "CSV must include 'username' and 'email' columns."}

    created = 0
    skipped = 0
    errors: List[str] = []
    firm_has_admin = LawyerProfile.objects.filter(
        firm=request.auth.firm, role="admin"
    ).exists()

    for row_number, row in enumerate(reader, start=2):
        username = (row.get(fields["username"]) or "").strip()
        email = (row.get(fields["email"]) or "").strip()
        role = (row.get(fields.get("role", ""), "") or "associate").strip() or "associate"

        if not username or not email:
            skipped += 1
            errors.append(f"Row {row_number}: missing username or email, skipped.")
            continue

        if User.objects.filter(username=username).exists():
            skipped += 1
            errors.append(f"Row {row_number}: username '{username}' already exists, skipped.")
            continue

        if User.objects.filter(email__iexact=email).exists():
            skipped += 1
            errors.append(
                f"Row {row_number}: email '{email}' is already associated with another "
                "firm's account, skipped."
            )
            continue

        if role not in FIRM_ASSIGNABLE_ROLES:
            skipped += 1
            errors.append(f"Row {row_number}: invalid role '{role}', skipped.")
            continue

        if role == "admin" and firm_has_admin:
            errors.append(
                f"Row {row_number}: firm already has an admin, '{username}' imported as "
                "associate instead."
            )
            role = "associate"

        user = User(
            username=username,
            email=email,
            first_name=(row.get(fields.get("first_name", ""), "") or "").strip(),
            last_name=(row.get(fields.get("last_name", ""), "") or "").strip(),
        )
        user.set_unusable_password()
        user.save()

        LawyerProfile.objects.create(
            user=user,
            firm=request.auth.firm,
            role=role,
            department=(row.get(fields.get("department", ""), "") or "").strip(),
        )

        if role == "admin":
            firm_has_admin = True

        try:
            send_lawyer_invite_email(user, request.auth.firm.name)
        except Exception:
            pass

        created += 1

    log_audit_event(
        request.auth.firm, request.auth, "lawyers_bulk_imported",
        f"{created} created, {skipped} skipped",
    )

    return 200, {"created": created, "skipped": skipped, "errors": errors[:20]}


@lawyer_router.post(
    "/{lawyer_id}/resend-invite/",
    response={200: LawyerCreateResponseSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def resend_invite(request, lawyer_id: int):
    denied = _require_admin(request)
    if denied:
        return denied

    try:
        profile = LawyerProfile.objects.select_related("user").get(
            id=lawyer_id, firm=request.auth.firm
        )
    except LawyerProfile.DoesNotExist:
        return 404, {"error": "Lawyer not found."}

    if profile.user.has_usable_password():
        return 400, {"error": "This lawyer has already set their password."}

    invite_link = build_invite_link(profile.user)
    email_sent = True

    try:
        send_lawyer_invite_email(profile.user, request.auth.firm.name)
    except Exception:
        email_sent = False

    result = _serialize_lawyer(profile)
    result["email_sent"] = email_sent
    result["invite_link"] = None if email_sent else invite_link

    return 200, result


@lawyer_router.patch(
    "/{lawyer_id}/",
    response={200: LawyerListItemSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def update_lawyer(request, lawyer_id: int, payload: LawyerUpdateSchema):
    denied = _require_admin(request)
    if denied:
        return denied

    try:
        profile = LawyerProfile.objects.select_related("user").get(
            id=lawyer_id, firm=request.auth.firm
        )
    except LawyerProfile.DoesNotExist:
        return 404, {"error": "Lawyer not found."}

    is_self_demotion = profile.id == request.auth.id and (
        payload.role is not None and payload.role != "admin"
    )

    if profile.id == request.auth.id and payload.is_active is False:
        return 400, {"error": "You cannot deactivate your own account."}

    other_admin_exists = LawyerProfile.objects.filter(
        firm=request.auth.firm, role="admin"
    ).exclude(id=profile.id).exists()

    firm_has_other_lawyers = LawyerProfile.objects.filter(
        firm=request.auth.firm
    ).exclude(id=profile.id).exists()

    if is_self_demotion and not other_admin_exists and firm_has_other_lawyers:
        if not payload.successor_id:
            return 400, {
                "error": "You are the firm's only admin. You must specify successor_id - "
                "the lawyer who will become the new admin - in the same request."
            }

        try:
            successor = LawyerProfile.objects.select_related("user").get(
                id=payload.successor_id, firm=request.auth.firm
            )
        except LawyerProfile.DoesNotExist:
            return 400, {"error": "successor_id does not match a lawyer at this firm."}

        if successor.id == profile.id:
            return 400, {"error": "successor_id cannot be the same lawyer you're demoting."}

        if not successor.user.is_active:
            return 400, {"error": "Cannot make an inactive lawyer the admin."}

        successor.role = "admin"
        successor.save()
        log_audit_event(
            request.auth.firm, request.auth, "lawyer_role_changed",
            f"{successor.user.username} -> admin (successor of self-demoted admin)",
        )

    if payload.role is not None:
        if payload.role not in FIRM_ASSIGNABLE_ROLES:
            return 400, {"error": "Invalid role."}

        if payload.role == "admin" and profile.role != "admin":
            current_admin = LawyerProfile.objects.filter(
                firm=request.auth.firm, role="admin"
            ).exclude(id=profile.id).first()

            if current_admin is not None:
                if current_admin.id != request.auth.id:
                    return 400, {
                        "error": "Only the current admin can transfer the admin role to someone else."
                    }

                current_admin.role = "partner"
                current_admin.save()
                log_audit_event(
                    request.auth.firm, request.auth, "lawyer_role_changed",
                    f"{current_admin.user.username} -> partner (admin role transferred)",
                )

        profile.role = payload.role
        profile.save()
        log_audit_event(
            request.auth.firm, request.auth, "lawyer_role_changed",
            f"{profile.user.username} -> {payload.role}",
        )

    if payload.department is not None:
        profile.department = payload.department
        profile.save()

    if payload.is_active is not None:
        profile.user.is_active = payload.is_active
        profile.user.save()
        log_audit_event(
            request.auth.firm, request.auth,
            "lawyer_activated" if payload.is_active else "lawyer_deactivated",
            profile.user.username,
        )

    return 200, _serialize_lawyer(profile)


@lawyer_router.delete(
    "/{lawyer_id}/",
    response={204: None, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def remove_lawyer(request, lawyer_id: int):
    denied = _require_admin(request)
    if denied:
        return denied

    try:
        profile = LawyerProfile.objects.select_related("user").get(
            id=lawyer_id, firm=request.auth.firm
        )
    except LawyerProfile.DoesNotExist:
        return 404, {"error": "Lawyer not found."}

    if profile.id == request.auth.id:
        return 400, {"error": "You cannot remove your own account."}

    if profile.role == "admin":
        other_admins = LawyerProfile.objects.filter(
            firm=request.auth.firm, role="admin"
        ).exclude(id=profile.id)
        if not other_admins.exists():
            return 400, {"error": "Cannot remove the firm's only admin."}

    username = profile.user.username
    profile.user.delete()

    log_audit_event(request.auth.firm, request.auth, "lawyer_removed", username)

    return 204, None


# ---------------------------------------------------------------------------
# Admin analytics dashboard
# ---------------------------------------------------------------------------


class AuditLogItemSchema(Schema):
    id: int
    actor_name: Optional[str] = None
    action: str
    details: str
    created_at: datetime


class AdminDashboardSchema(Schema):
    total_users: int
    active_users: int
    pending_invitations: int
    documents_uploaded: int
    ai_queries: int
    drafts_generated: int
    recent_activity: List[AuditLogItemSchema]


@router.get(
    "/admin-dashboard/",
    auth=JWTAuth(),
    response={200: AdminDashboardSchema, 403: ErrorSchema},
)
def admin_dashboard(request):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    from api.models import ChatMessage, UploadedDocument
    from drafts.models import Draft

    firm = request.auth.firm
    profiles = LawyerProfile.objects.filter(firm=firm).select_related("user")
    recent_logs = firm.audit_logs.select_related("actor__user")[:20]

    return 200, {
        "total_users": profiles.count(),
        "active_users": profiles.filter(user__is_active=True).count(),
        "pending_invitations": sum(
            1 for profile in profiles if not profile.user.has_usable_password()
        ),
        "documents_uploaded": UploadedDocument.objects.filter(firm=firm).count(),
        "ai_queries": ChatMessage.objects.filter(document__firm=firm).count(),
        "drafts_generated": Draft.objects.filter(firm=firm).count(),
        "recent_activity": [
            {
                "id": log.id,
                "actor_name": (
                    (log.actor.user.get_full_name() or log.actor.user.username)
                    if log.actor
                    else None
                ),
                "action": log.action,
                "details": log.details,
                "created_at": log.created_at,
            }
            for log in recent_logs
        ],
    }
