"""
Google Drive integration - lets a firm link a shared Drive folder so its
PDFs get indexed into the same per-firm RAG collection as manually
uploaded documents. Tokens are stored per-firm (see GoogleDriveConnection
docstring in models.py) since the linked folder is a shared firm
resource, not a personal one.

OAuth flow:
1. Frontend calls GET .../connect/ (authenticated) -> gets a Google
   consent URL with a signed `state` param encoding firm_id/lawyer_id.
2. Browser navigates to Google, user approves, Google redirects the
   browser (unauthenticated - no JWT survives that hop) to
   .../callback/, a plain Django view that recovers firm/lawyer from the
   signed state and exchanges the code for tokens.
3. Frontend then calls POST .../folder/ with a pasted folder link to
   select which folder to sync, and POST .../sync/ to index its PDFs.
"""

import re
import secrets
from datetime import timezone as dt_timezone
from typing import List, Optional

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.http import HttpResponseBadRequest, HttpResponseRedirect
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from ninja import Router, Schema

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from .audit import log_audit_event
from .auth import JWTAuth
from .models import Firm, GoogleDriveConnection, LawyerProfile
from .permissions import require_permission

SIGNING_SALT = "google-drive-oauth-state"
FOLDER_LINK_RE = re.compile(r"/folders/([a-zA-Z0-9_-]+)")
FOLDER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{10,}$")


def _client_config():
    return {
        "web": {
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.GOOGLE_OAUTH_REDIRECT_URI],
        }
    }


def _make_flow(code_verifier: Optional[str] = None) -> Flow:
    """
    PKCE requires the same code_verifier used to build the authorization
    URL to be replayed when exchanging the code for tokens. Since connect()
    and the callback are two separate requests (and, in this stateless JWT
    app, two separate Flow objects with no shared session), the verifier
    can't just live on a Flow instance in memory - it's threaded through
    explicitly instead: generated in connect(), carried in the signed
    `state` param, and passed back in here on the callback.
    """
    return Flow.from_client_config(
        _client_config(),
        scopes=settings.GOOGLE_DRIVE_SCOPES,
        redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        code_verifier=code_verifier,
        autogenerate_code_verifier=code_verifier is None,
    )


def _to_naive_utc(value):
    if value is None:
        return None
    return timezone.localtime(value, dt_timezone.utc).replace(tzinfo=None)


def _to_aware_utc(value):
    if value is None:
        return None
    return timezone.make_aware(value, dt_timezone.utc)


def _drive_service(connection: GoogleDriveConnection):
    creds = Credentials(
        token=connection.access_token,
        refresh_token=connection.refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_OAUTH_CLIENT_ID,
        client_secret=settings.GOOGLE_OAUTH_CLIENT_SECRET,
        scopes=settings.GOOGLE_DRIVE_SCOPES,
        expiry=_to_naive_utc(connection.token_expiry),
    )

    if not creds.valid:
        creds.refresh(GoogleAuthRequest())
        connection.access_token = creds.token
        connection.token_expiry = _to_aware_utc(creds.expiry)
        # A sync can run long enough for the user to disconnect Drive
        # mid-request, deleting this row out from under us - use a
        # queryset-level update (no-op if the row is gone) instead of
        # save(update_fields=...), which raises DatabaseError in that case.
        GoogleDriveConnection.objects.filter(pk=connection.pk).update(
            access_token=connection.access_token,
            token_expiry=connection.token_expiry,
        )

    return build("drive", "v3", credentials=creds, cache_discovery=False)


def _extract_folder_id(value: str) -> str:
    value = value.strip()
    match = FOLDER_LINK_RE.search(value)
    if match:
        return match.group(1)
    if FOLDER_ID_RE.match(value):
        return value
    return ""


google_drive_router = Router(auth=JWTAuth())


class ConnectResponseSchema(Schema):
    auth_url: str


class StatusResponseSchema(Schema):
    connected: bool
    folder_id: str = ""
    folder_name: str = ""
    folder_link: str = ""
    last_synced_at: Optional[str] = None


class FolderLinkSchema(Schema):
    folder_link: str


class SyncResultSchema(Schema):
    synced: int
    updated: int
    skipped: int
    errors: List[str]


class ErrorSchema(Schema):
    error: str


def _require_manage(request):
    return require_permission(request, "manage_team")


def _status_payload(connection: Optional[GoogleDriveConnection]) -> dict:
    if connection is None:
        return {"connected": False}

    return {
        "connected": True,
        "folder_id": connection.folder_id,
        "folder_name": connection.folder_name,
        "folder_link": connection.folder_link,
        "last_synced_at": connection.last_synced_at.isoformat() if connection.last_synced_at else None,
    }


@google_drive_router.get(
    "/connect/",
    response={200: ConnectResponseSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def connect(request):
    denied = _require_manage(request)
    if denied:
        return denied

    if not settings.GOOGLE_OAUTH_CLIENT_ID or not settings.GOOGLE_OAUTH_CLIENT_SECRET:
        return 400, {"error": "Google Drive integration is not configured on this server."}

    code_verifier = secrets.token_urlsafe(64)
    flow = _make_flow(code_verifier=code_verifier)
    state = signing.dumps(
        {
            "firm_id": request.auth.firm_id,
            "lawyer_id": request.auth.id,
            "code_verifier": code_verifier,
        },
        salt=SIGNING_SALT,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )

    return 200, {"auth_url": auth_url}


@google_drive_router.get("/status/", response={200: StatusResponseSchema})
def status(request):
    connection = GoogleDriveConnection.objects.filter(firm=request.auth.firm).first()
    return 200, _status_payload(connection)


@google_drive_router.post(
    "/folder/",
    response={200: StatusResponseSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def set_folder(request, payload: FolderLinkSchema):
    denied = _require_manage(request)
    if denied:
        return denied

    connection = GoogleDriveConnection.objects.filter(firm=request.auth.firm).first()
    if connection is None:
        return 404, {"error": "Connect Google Drive first."}

    folder_id = _extract_folder_id(payload.folder_link)
    if not folder_id:
        return 400, {"error": "Could not find a folder ID in that link."}

    try:
        service = _drive_service(connection)
        folder = service.files().get(
            fileId=folder_id, fields="id,name,mimeType,webViewLink"
        ).execute()
    except HttpError as error:
        return 400, {
            "error": "Could not access that folder - make sure it's shared with the "
            f"connected Google account. ({error})"
        }

    if folder.get("mimeType") != "application/vnd.google-apps.folder":
        return 400, {"error": "That link doesn't point to a folder."}

    connection.folder_id = folder_id
    connection.folder_name = folder.get("name", "")
    connection.folder_link = folder.get("webViewLink") or payload.folder_link
    connection.save()

    log_audit_event(request.auth.firm, request.auth, "drive_folder_linked", connection.folder_name)

    return 200, _status_payload(connection)


@google_drive_router.delete(
    "/folder/",
    response={200: StatusResponseSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def clear_folder(request):
    """Removes folder scoping - future syncs search the whole connected Drive."""
    denied = _require_manage(request)
    if denied:
        return denied

    connection = GoogleDriveConnection.objects.filter(firm=request.auth.firm).first()
    if connection is None:
        return 404, {"error": "Connect Google Drive first."}

    connection.folder_id = ""
    connection.folder_name = ""
    connection.folder_link = ""
    connection.save()

    log_audit_event(request.auth.firm, request.auth, "drive_folder_unlinked", "")

    return 200, _status_payload(connection)


@google_drive_router.post(
    "/sync/",
    response={200: SyncResultSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def sync_folder(request):
    denied = _require_manage(request)
    if denied:
        return denied

    connection = GoogleDriveConnection.objects.filter(firm=request.auth.firm).first()
    if connection is None:
        return 404, {"error": "Connect Google Drive first."}

    from api.models import UploadedDocument
    from rag.rag_pipeline import process_uploaded_document

    synced = 0
    updated = 0
    skipped = 0
    errors: List[str] = []

    # A linked folder narrows the search to just that folder; otherwise
    # every PDF the connected account can see is fair game - the user
    # explicitly chose "search my whole Drive" over folder scoping.
    query = "mimeType='application/pdf' and trashed=false"
    if connection.folder_id:
        query = f"'{connection.folder_id}' in parents and {query}"

    drive_files = []
    try:
        service = _drive_service(connection)
        page_token = None
        while True:
            response = service.files().list(
                q=query,
                fields="nextPageToken, files(id,name,modifiedTime)",
                pageSize=200,
                pageToken=page_token,
            ).execute()
            drive_files.extend(response.get("files", []))
            page_token = response.get("nextPageToken")
            if not page_token:
                break
    except HttpError as error:
        return 400, {"error": f"Could not list files in Google Drive: {error}"}

    for drive_file in drive_files:
        drive_file_id = drive_file["id"]
        file_name = drive_file["name"]
        modified_time = parse_datetime(drive_file.get("modifiedTime", "")) if drive_file.get("modifiedTime") else None

        existing = UploadedDocument.objects.filter(
            firm=request.auth.firm, drive_file_id=drive_file_id
        ).first()

        if (
            existing
            and existing.drive_modified_at
            and modified_time
            and existing.drive_modified_at >= modified_time
        ):
            skipped += 1
            continue

        try:
            content = service.files().get_media(fileId=drive_file_id).execute()
        except HttpError as error:
            errors.append(f"{file_name}: could not download ({error})")
            continue

        if existing:
            existing.file.save(file_name, ContentFile(content), save=False)
            existing.original_name = file_name
            existing.drive_modified_at = modified_time
            existing.save()
            document = existing
        else:
            document = UploadedDocument.objects.create(
                original_name=file_name,
                document_type="pdf",
                firm=request.auth.firm,
                source="drive",
                drive_file_id=drive_file_id,
                drive_modified_at=modified_time,
            )
            document.file.save(file_name, ContentFile(content), save=True)

        try:
            total_chunks = process_uploaded_document(document)
            document.total_chunks = total_chunks
            document.save(update_fields=["total_chunks"])
        except Exception as error:
            errors.append(f"{file_name}: indexing failed ({error})")
            continue

        if existing:
            updated += 1
        else:
            synced += 1

    # Same race as the token refresh above - the connection may have been
    # disconnected while this sync (file listing + downloading + indexing)
    # was still running. A no-op update is fine; a hard failure here would
    # discard an otherwise-successful sync's results.
    GoogleDriveConnection.objects.filter(pk=connection.pk).update(last_synced_at=timezone.now())

    log_audit_event(
        request.auth.firm, request.auth, "drive_synced",
        f"{synced} new, {updated} updated, {skipped} unchanged, {len(errors)} errors",
    )

    return 200, {"synced": synced, "updated": updated, "skipped": skipped, "errors": errors}


@google_drive_router.delete("/", response={204: None, 403: ErrorSchema, 404: ErrorSchema})
def disconnect(request):
    denied = _require_manage(request)
    if denied:
        return denied

    connection = GoogleDriveConnection.objects.filter(firm=request.auth.firm).first()
    if connection is None:
        return 404, {"error": "Not connected."}

    connection.delete()
    log_audit_event(request.auth.firm, request.auth, "drive_disconnected", "")

    return 204, None


def google_drive_oauth_callback(request):
    """
    Plain Django view (not a Ninja route, no JWTAuth) - Google redirects
    the user's browser here directly, with no way to carry a bearer
    token across that hop. Identity is instead recovered from the signed
    `state` param minted in connect() above.
    """

    error = request.GET.get("error")
    if error:
        return HttpResponseRedirect(f"{settings.FRONTEND_URL}/team?drive_error={error}")

    code = request.GET.get("code")
    state = request.GET.get("state")

    if not code or not state:
        return HttpResponseBadRequest("Missing code or state.")

    try:
        payload = signing.loads(state, salt=SIGNING_SALT, max_age=600)
    except signing.BadSignature:
        return HttpResponseBadRequest("Invalid or expired state.")

    try:
        firm = Firm.objects.get(id=payload["firm_id"])
        lawyer = LawyerProfile.objects.get(id=payload["lawyer_id"])
    except (Firm.DoesNotExist, LawyerProfile.DoesNotExist):
        return HttpResponseBadRequest("Firm or lawyer no longer exists.")

    flow = _make_flow(code_verifier=payload.get("code_verifier"))
    flow.fetch_token(code=code)
    creds = flow.credentials

    connection = GoogleDriveConnection.objects.filter(firm=firm).first()
    if connection is None:
        connection = GoogleDriveConnection(firm=firm)

    connection.connected_by = lawyer
    connection.access_token = creds.token
    if creds.refresh_token:
        connection.refresh_token = creds.refresh_token
    connection.token_expiry = _to_aware_utc(creds.expiry)
    connection.save()

    log_audit_event(firm, lawyer, "drive_connected", "")

    return HttpResponseRedirect(f"{settings.FRONTEND_URL}/team?drive_connected=1")
