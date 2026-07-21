"""
Firm LLM configuration - lets a firm run the platform on its own LLM API
key instead of the platform's default Groq credentials.

Design notes:
- One stored config per (firm, provider); at most one is active. No
  active config = platform default.
- Keys are validated with a live, read-only call to the provider (a
  models-list request) both on demand and before saving, so a typo'd key
  is caught immediately instead of surfacing later as a broken chat.
- Stored keys are never returned to the client - only a masked tail.
- Only providers in FirmLLMConfig.ROUTABLE_PROVIDERS can be activated
  today; other providers' keys can still be saved/validated so the firm
  is ready the moment routing for them ships.
"""

from datetime import datetime
from typing import List, Optional

import requests
from django.conf import settings
from django.utils import timezone
from ninja import Router, Schema

from .audit import log_audit_event
from .auth import JWTAuth
from .models import FirmLLMConfig
from .permissions import require_permission

llm_config_router = Router(auth=JWTAuth())

VALID_PROVIDERS = [choice[0] for choice in FirmLLMConfig.PROVIDER_CHOICES]
PROVIDER_LABELS = dict(FirmLLMConfig.PROVIDER_CHOICES)

_VALIDATION_TIMEOUT = 15


def _validate_api_key(provider: str, api_key: str) -> Optional[str]:
    """
    Live-checks the key against the provider with a cheap read-only
    request. Returns None when the key works, otherwise a human-readable
    error message.
    """
    try:
        if provider == "groq":
            response = requests.get(
                "https://api.groq.com/openai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=_VALIDATION_TIMEOUT,
            )
        elif provider == "openai":
            response = requests.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=_VALIDATION_TIMEOUT,
            )
        elif provider == "anthropic":
            response = requests.get(
                "https://api.anthropic.com/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                timeout=_VALIDATION_TIMEOUT,
            )
        elif provider == "gemini":
            response = requests.get(
                "https://generativelanguage.googleapis.com/v1beta/models",
                headers={"x-goog-api-key": api_key},
                timeout=_VALIDATION_TIMEOUT,
            )
        else:
            return "Unknown provider."
    except requests.RequestException:
        return f"Could not reach {PROVIDER_LABELS.get(provider, provider)} to validate the key. Please try again."

    if response.status_code in (401, 403):
        return f"{PROVIDER_LABELS.get(provider, provider)} rejected this API key. Please check it and try again."

    if response.status_code >= 400:
        return (
            f"{PROVIDER_LABELS.get(provider, provider)} returned an unexpected error "
            f"(HTTP {response.status_code}) while validating the key."
        )

    return None


class LLMConfigItemSchema(Schema):
    provider: str
    provider_label: str
    model_name: str
    masked_key: str
    is_active: bool
    routable: bool
    last_validated_at: Optional[datetime] = None
    updated_at: datetime


class LLMConfigStatusSchema(Schema):
    using_platform_default: bool
    active_provider: Optional[str] = None
    platform_provider: str
    platform_model: str
    routable_providers: List[str]
    configs: List[LLMConfigItemSchema]


class LLMKeySchema(Schema):
    api_key: str
    model_name: str = ""


class LLMValidateSchema(Schema):
    provider: str
    api_key: str


class LLMValidateResultSchema(Schema):
    valid: bool
    error: Optional[str] = None


class ErrorSchema(Schema):
    error: str


def _serialize_config(config: FirmLLMConfig) -> dict:
    return {
        "provider": config.provider,
        "provider_label": PROVIDER_LABELS.get(config.provider, config.provider),
        "model_name": config.model_name,
        "masked_key": config.masked_key(),
        "is_active": config.is_active,
        "routable": config.provider in FirmLLMConfig.ROUTABLE_PROVIDERS,
        "last_validated_at": config.last_validated_at,
        "updated_at": config.updated_at,
    }


def _status(firm) -> dict:
    configs = list(firm.llm_configs.order_by("provider"))
    active = next((config for config in configs if config.is_active), None)

    return {
        "using_platform_default": active is None,
        "active_provider": active.provider if active else None,
        "platform_provider": "groq",
        "platform_model": settings.GROQ_MODEL,
        "routable_providers": FirmLLMConfig.ROUTABLE_PROVIDERS,
        "configs": [_serialize_config(config) for config in configs],
    }


@llm_config_router.get("/", response={200: LLMConfigStatusSchema})
def get_llm_config(request):
    return 200, _status(request.auth.firm)


@llm_config_router.post(
    "/validate/", response={200: LLMValidateResultSchema, 400: ErrorSchema, 403: ErrorSchema}
)
def validate_llm_key(request, payload: LLMValidateSchema):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    if payload.provider not in VALID_PROVIDERS:
        return 400, {"error": "Unknown provider."}

    if not payload.api_key.strip():
        return 400, {"error": "API key is required."}

    error = _validate_api_key(payload.provider, payload.api_key.strip())
    return 200, {"valid": error is None, "error": error}


# NOTE: literal routes (/validate/, /platform-default/) must be registered
# before the dynamic /{provider}/ ones below - same class of route-ordering
# issue documented in drafts/api.py, cases/api.py, and accounts/api.py.


@llm_config_router.post(
    "/platform-default/",
    response={200: LLMConfigStatusSchema, 403: ErrorSchema},
)
def use_platform_default(request):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    firm = request.auth.firm
    firm.llm_configs.update(is_active=False)

    log_audit_event(firm, request.auth, "llm_platform_default_restored")
    return 200, _status(firm)


@llm_config_router.put(
    "/{provider}/",
    response={200: LLMConfigStatusSchema, 400: ErrorSchema, 403: ErrorSchema},
)
def save_llm_key(request, provider: str, payload: LLMKeySchema):
    """Create or replace the firm's key for one provider. The key is
    validated live before anything is stored."""
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    if provider not in VALID_PROVIDERS:
        return 400, {"error": "Unknown provider."}

    api_key = payload.api_key.strip()
    if not api_key:
        return 400, {"error": "API key is required."}

    error = _validate_api_key(provider, api_key)
    if error:
        return 400, {"error": error}

    firm = request.auth.firm
    config, _created = FirmLLMConfig.objects.update_or_create(
        firm=firm,
        provider=provider,
        defaults={
            "api_key": api_key,
            "model_name": payload.model_name.strip(),
            "last_validated_at": timezone.now(),
            "created_by": request.auth,
        },
    )

    log_audit_event(firm, request.auth, "llm_key_saved", provider)
    return 200, _status(firm)


@llm_config_router.post(
    "/{provider}/activate/",
    response={200: LLMConfigStatusSchema, 400: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def activate_llm_provider(request, provider: str):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    firm = request.auth.firm

    try:
        config = firm.llm_configs.get(provider=provider)
    except FirmLLMConfig.DoesNotExist:
        return 404, {"error": "No saved API key for this provider. Save one first."}

    if provider not in FirmLLMConfig.ROUTABLE_PROVIDERS:
        return 400, {
            "error": f"{PROVIDER_LABELS.get(provider, provider)} keys can be stored and "
            "validated, but routing requests through this provider isn't available yet."
        }

    firm.llm_configs.update(is_active=False)
    config.is_active = True
    config.save(update_fields=["is_active"])

    log_audit_event(firm, request.auth, "llm_provider_activated", provider)
    return 200, _status(firm)


@llm_config_router.delete(
    "/{provider}/",
    response={200: LLMConfigStatusSchema, 403: ErrorSchema, 404: ErrorSchema},
)
def delete_llm_key(request, provider: str):
    denied = require_permission(request, "manage_team")
    if denied:
        return denied

    firm = request.auth.firm

    try:
        config = firm.llm_configs.get(provider=provider)
    except FirmLLMConfig.DoesNotExist:
        return 404, {"error": "No saved API key for this provider."}

    # Deleting the active key silently falls back to the platform default -
    # the status payload the client gets back makes that explicit.
    config.delete()

    log_audit_event(firm, request.auth, "llm_key_removed", provider)
    return 200, _status(firm)
