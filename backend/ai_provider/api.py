"""
Settings > AI Configuration / API Integrations endpoints. Entirely new,
additive API surface - does not modify or replace any existing endpoint
(chat, drafting, documents, etc. all keep working unchanged). Writes are
Workspace Admin only (reuses accounts.permissions.require_permission's
existing "manage_team" gate, unmodified); reads are available to any
authenticated lawyer at the workspace (read-only for non-admins, per spec).
"""

from typing import List, Optional

from ninja import Router, Schema

from accounts.audit import log_audit_event
from accounts.auth import JWTAuth
from accounts.permissions import require_permission
from .encryption import decrypt_secret, encrypt_secret
from .models import WorkspaceAIConfiguration, WorkspaceAPIKey
from .resolver import AIProviderResolver

settings_router = Router(auth=JWTAuth())


class ErrorSchema(Schema):
    error: str


class SuccessSchema(Schema):
    success: bool


# ---------------------------------------------------------------------------
# GET/PUT /settings/ai-provider
# ---------------------------------------------------------------------------


class AIProviderModeSchema(Schema):
    provider_mode: str
    has_connected_credential: bool


class AIProviderModeUpdateSchema(Schema):
    provider_mode: str


def _has_connected_credential(workspace) -> bool:
    return WorkspaceAPIKey.objects.filter(workspace=workspace, enabled=True, status="connected").exists()


@settings_router.get("/ai-provider/", response={200: AIProviderModeSchema})
def get_ai_provider_mode(request):
    workspace = request.auth.firm
    configuration = WorkspaceAIConfiguration.objects.filter(workspace=workspace).first()
    mode = configuration.provider_mode if configuration else WorkspaceAIConfiguration.PLATFORM
    return 200, {"provider_mode": mode, "has_connected_credential": _has_connected_credential(workspace)}


@settings_router.put(
    "/ai-provider/", response={200: AIProviderModeSchema, 400: ErrorSchema, 403: ErrorSchema}
)
def update_ai_provider_mode(request, payload: AIProviderModeUpdateSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    mode = payload.provider_mode.upper()
    if mode not in (WorkspaceAIConfiguration.PLATFORM, WorkspaceAIConfiguration.CUSTOMER):
        return 400, {"error": "provider_mode must be 'PLATFORM' or 'CUSTOMER'."}

    workspace = request.auth.firm

    if mode == WorkspaceAIConfiguration.CUSTOMER and not _has_connected_credential(workspace):
        return 400, {
            "error": (
                "Connect and enable at least one AI provider in API Integrations "
                "before switching to Customer Managed mode."
            )
        }

    configuration, _ = WorkspaceAIConfiguration.objects.update_or_create(
        workspace=workspace, defaults={"provider_mode": mode}
    )

    log_audit_event(
        firm=workspace,
        actor=request.auth,
        action="ai_provider_mode_changed",
        details=f"Switched AI Provider Mode to {mode}.",
    )

    return 200, {
        "provider_mode": configuration.provider_mode,
        "has_connected_credential": _has_connected_credential(workspace),
    }


# ---------------------------------------------------------------------------
# GET/POST /settings/api-integrations, PUT/DELETE /settings/api-integrations/{provider}
# ---------------------------------------------------------------------------


class APIIntegrationSchema(Schema):
    provider: str
    configured: bool
    enabled: bool
    status: str
    last_tested_at: Optional[str] = None
    last_test_message: str
    key_hint: str
    base_url: str
    model: str


class APIIntegrationSaveSchema(Schema):
    provider: str
    api_key: str
    base_url: str = ""
    model: str = ""
    extra_config: dict = {}


class APIIntegrationUpdateSchema(Schema):
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None
    extra_config: Optional[dict] = None
    enabled: Optional[bool] = None


_PROVIDER_IDS = [p for p, _ in WorkspaceAPIKey.PROVIDER_CHOICES]


def _mask_key_hint(credential) -> str:
    if credential is None or not credential.encrypted_api_key:
        return ""
    try:
        plaintext = decrypt_secret(credential.encrypted_api_key)
    except ValueError:
        return "****"
    return f"****{plaintext[-4:]}" if len(plaintext) >= 4 else "****"


def _serialize(provider: str, credential) -> dict:
    if credential is None:
        return {
            "provider": provider,
            "configured": False,
            "enabled": False,
            "status": "untested",
            "last_tested_at": None,
            "last_test_message": "",
            "key_hint": "",
            "base_url": "",
            "model": "",
        }
    return {
        "provider": provider,
        "configured": True,
        "enabled": credential.enabled,
        "status": credential.status,
        "last_tested_at": credential.last_tested_at.isoformat() if credential.last_tested_at else None,
        "last_test_message": credential.last_test_message,
        "key_hint": _mask_key_hint(credential),
        "base_url": credential.base_url,
        "model": credential.model,
    }


@settings_router.get("/api-integrations/", response={200: List[APIIntegrationSchema]})
def list_api_integrations(request):
    workspace = request.auth.firm
    credentials = {c.provider: c for c in WorkspaceAPIKey.objects.filter(workspace=workspace)}
    return 200, [_serialize(provider, credentials.get(provider)) for provider in _PROVIDER_IDS]


@settings_router.post(
    "/api-integrations/", response={201: APIIntegrationSchema, 400: ErrorSchema, 403: ErrorSchema}
)
def create_api_integration(request, payload: APIIntegrationSaveSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    if payload.provider not in _PROVIDER_IDS:
        return 400, {"error": f"'{payload.provider}' is not a recognized AI provider."}
    if not payload.api_key or not payload.api_key.strip():
        return 400, {"error": "api_key is required."}

    workspace = request.auth.firm
    credential, _ = WorkspaceAPIKey.objects.update_or_create(
        workspace=workspace,
        provider=payload.provider,
        defaults={
            "encrypted_api_key": encrypt_secret(payload.api_key.strip()),
            "base_url": payload.base_url.strip(),
            "model": payload.model.strip(),
            "extra_config": payload.extra_config or {},
            "status": "untested",
            "last_tested_at": None,
            "last_test_message": "",
            "created_by": request.auth,
        },
    )

    log_audit_event(
        firm=workspace,
        actor=request.auth,
        action="ai_provider_credential_saved",
        details=f"Saved credentials for {payload.provider}.",
    )

    return 201, _serialize(payload.provider, credential)


def _get_credential_or_error(workspace, provider: str):
    if provider not in _PROVIDER_IDS:
        return None, (400, {"error": f"'{provider}' is not a recognized AI provider."})
    try:
        return WorkspaceAPIKey.objects.get(workspace=workspace, provider=provider), None
    except WorkspaceAPIKey.DoesNotExist:
        return None, (400, {"error": f"No credential saved yet for {provider}."})


# ---------------------------------------------------------------------------
# POST /settings/api-integrations/test
#
# Registered here, BEFORE the /api-integrations/{provider} routes below:
# Django's URL resolver matches path patterns in registration order, and
# "/api-integrations/test" would otherwise be captured by the wildcard
# "/api-integrations/{provider}" pattern (provider="test") since that
# pattern is tried first, causing a 405 rather than ever reaching this
# view. Literal paths must be registered before wildcard siblings that
# could also match them.
# ---------------------------------------------------------------------------


class APIIntegrationTestSchema(Schema):
    provider: str


def _test_provider_connection(credential) -> "tuple[bool, str]":
    """Real, lightweight live validation call - never raises."""
    import requests

    provider = credential.provider
    try:
        api_key = decrypt_secret(credential.encrypted_api_key)
    except ValueError as error:
        return False, str(error)

    try:
        if provider == "openai":
            response = requests.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
        elif provider == "groq":
            response = requests.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
        elif provider == "mistral":
            response = requests.get(
                "https://api.mistral.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=10,
            )
        elif provider == "azure_openai":
            if not credential.base_url:
                return False, "Azure OpenAI requires a resource endpoint (base URL)."
            api_version = (credential.extra_config or {}).get("api_version", "2024-10-21")
            response = requests.get(
                f"{credential.base_url.rstrip('/')}/openai/models?api-version={api_version}",
                headers={"api-key": api_key},
                timeout=10,
            )
        elif provider == "anthropic":
            response = requests.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                timeout=10,
            )
        elif provider == "gemini":
            response = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": api_key},
                timeout=10,
            )
        else:
            return False, f"Unknown provider '{provider}'."
    except requests.RequestException as error:
        return False, f"Connection failed: {error}"

    if response.status_code == 200:
        return True, "Connection succeeded."
    if response.status_code in (401, 403):
        return False, "The API key was rejected (invalid or insufficient permissions)."
    return False, f"Provider returned HTTP {response.status_code}."


@settings_router.post(
    "/api-integrations/test/",
    response={200: APIIntegrationSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def test_api_integration(request, payload: APIIntegrationTestSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    workspace = request.auth.firm
    credential, error = _get_credential_or_error(workspace, payload.provider)
    if error:
        return error

    success, message = _test_provider_connection(credential)

    from django.utils import timezone

    credential.status = "connected" if success else "failed"
    credential.last_tested_at = timezone.now()
    credential.last_test_message = message
    credential.save(update_fields=["status", "last_tested_at", "last_test_message"])

    log_audit_event(
        firm=workspace,
        actor=request.auth,
        action="ai_provider_test_connection",
        details=f"Tested {payload.provider}: {'success' if success else 'failed'} - {message}",
    )

    return 200, _serialize(payload.provider, credential)


# ---------------------------------------------------------------------------
# PUT/DELETE /settings/api-integrations/{provider}
# ---------------------------------------------------------------------------


@settings_router.put(
    "/api-integrations/{provider}/",
    response={200: APIIntegrationSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def update_api_integration(request, provider: str, payload: APIIntegrationUpdateSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    workspace = request.auth.firm
    credential, error = _get_credential_or_error(workspace, provider)
    if error:
        return error

    if payload.api_key is not None and payload.api_key.strip():
        credential.encrypted_api_key = encrypt_secret(payload.api_key.strip())
        credential.status = "untested"
        credential.last_tested_at = None
        credential.last_test_message = ""
    if payload.base_url is not None:
        credential.base_url = payload.base_url.strip()
    if payload.model is not None:
        credential.model = payload.model.strip()
    if payload.extra_config is not None:
        credential.extra_config = payload.extra_config

    if payload.enabled is True:
        if credential.status != "connected":
            return 400, {"error": "Test the connection successfully before enabling this provider."}
        # At most one enabled credential per workspace - "exactly one
        # active provider" mirrors "exactly one provider_mode".
        WorkspaceAPIKey.objects.filter(workspace=workspace).exclude(id=credential.id).update(enabled=False)
        credential.enabled = True
    elif payload.enabled is False:
        configuration = WorkspaceAIConfiguration.objects.filter(workspace=workspace).first()
        if (
            credential.enabled
            and configuration is not None
            and configuration.provider_mode == WorkspaceAIConfiguration.CUSTOMER
        ):
            return 400, {
                "error": (
                    "This is the active provider for Customer Managed mode - enable a "
                    "different provider first, or switch back to Platform Managed."
                )
            }
        credential.enabled = False

    credential.save()

    log_audit_event(
        firm=workspace,
        actor=request.auth,
        action="ai_provider_credential_updated",
        details=f"Updated {provider}.",
    )

    return 200, _serialize(provider, credential)


@settings_router.delete(
    "/api-integrations/{provider}/",
    response={200: SuccessSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def delete_api_integration(request, provider: str):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    workspace = request.auth.firm
    credential, error = _get_credential_or_error(workspace, provider)
    if error:
        return error

    configuration = WorkspaceAIConfiguration.objects.filter(workspace=workspace).first()
    if (
        credential.enabled
        and configuration is not None
        and configuration.provider_mode == WorkspaceAIConfiguration.CUSTOMER
    ):
        return 400, {
            "error": (
                "This is the active provider for Customer Managed mode - enable a "
                "different provider first, or switch back to Platform Managed."
            )
        }

    credential.delete()

    log_audit_event(
        firm=workspace,
        actor=request.auth,
        action="ai_provider_credential_deleted",
        details=f"Deleted stored credential for {provider}.",
    )

    return 200, {"success": True}
