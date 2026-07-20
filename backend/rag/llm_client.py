"""
The single choke point every AI-calling function in this codebase goes
through to get a client - see the ~17 former get_groq_client() call sites,
now get_ai_client(firm). Firm=None (or a firm still in "platform_managed"
mode) returns the platform's own Groq client, byte-identical to this
codebase's behavior before AI Provider Mode existed. A firm in
"customer_managed" mode routes through its own connected credential instead
- and only that credential; there is never a fallback to the platform key,
by design (see the AI Provider Mode plan / spec).

Groq, OpenAI, Mistral, and Azure OpenAI are all OpenAI-wire-compatible, so
they're used via their real native SDK clients with zero translation - only
Anthropic and Gemini need the shims in llm_adapters.py. Every client this
function returns exposes the same `.chat.completions.create(...)` /
`.default_model` / `.tool_model` surface regardless of provider.
"""

import anthropic
import groq
import openai
from django.conf import settings

from accounts.encryption import decrypt_secret
from .llm_adapters import AnthropicCompatClient, GeminiCompatClient, ChatNamespace
from .llm_errors import AIBadRequestError, AIProviderNotConfigured, AIRateLimitError

# Groq-specific tuning: openai/gpt-oss-120b was empirically tested as more
# reliable than the main chat model for this agent's exact tool set - see
# research_agent.py's tool-calling loop. Applies to any Groq credential
# (platform or BYOK), since it's about Groq's own model lineup, not who pays.
AGENT_TOOL_MODEL = "openai/gpt-oss-120b"

_DEFAULT_MODELS = {
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-5",
    "google_gemini": "gemini-2.0-flash",
    "azure_openai": "",  # deployment name - no sensible generic default
    "groq": settings.GROQ_MODEL,
    "mistral": "mistral-large-latest",
}


class _NativeCompletions:
    """Wraps any OpenAI-wire-compatible native client's chat.completions so
    its provider-specific rate-limit/bad-request exceptions are normalized -
    callers only ever need to catch AIRateLimitError/AIBadRequestError,
    regardless of which of the 4 OpenAI-compatible providers actually served
    the request."""

    def __init__(self, native_client, rate_limit_exc, bad_request_exc):
        self._client = native_client
        self._rate_limit_exc = rate_limit_exc
        self._bad_request_exc = bad_request_exc

    def create(self, **kwargs):
        try:
            return self._client.chat.completions.create(**kwargs)
        except self._rate_limit_exc as error:
            raise AIRateLimitError(str(error)) from error
        except self._bad_request_exc as error:
            raise AIBadRequestError(str(error)) from error


class _NativeClientWrapper:
    def __init__(self, native_client, default_model, tool_model, rate_limit_exc, bad_request_exc):
        self.chat = ChatNamespace(_NativeCompletions(native_client, rate_limit_exc, bad_request_exc))
        self.default_model = default_model
        self.tool_model = tool_model


def _platform_client():
    if not settings.GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is missing in .env file.")
    return _NativeClientWrapper(
        groq.Groq(api_key=settings.GROQ_API_KEY),
        default_model=settings.GROQ_MODEL,
        tool_model=AGENT_TOOL_MODEL,
        rate_limit_exc=groq.RateLimitError,
        bad_request_exc=groq.BadRequestError,
    )


def _byok_client(credential):
    provider = credential.provider
    api_key = decrypt_secret(credential.encrypted_api_key)
    model = credential.model or _DEFAULT_MODELS.get(provider, "")

    if provider == "groq":
        return _NativeClientWrapper(
            groq.Groq(api_key=api_key),
            default_model=model,
            tool_model=model,
            rate_limit_exc=groq.RateLimitError,
            bad_request_exc=groq.BadRequestError,
        )
    if provider == "openai":
        return _NativeClientWrapper(
            openai.OpenAI(api_key=api_key),
            default_model=model,
            tool_model=model,
            rate_limit_exc=openai.RateLimitError,
            bad_request_exc=openai.BadRequestError,
        )
    if provider == "mistral":
        return _NativeClientWrapper(
            openai.OpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1"),
            default_model=model,
            tool_model=model,
            rate_limit_exc=openai.RateLimitError,
            bad_request_exc=openai.BadRequestError,
        )
    if provider == "azure_openai":
        api_version = (credential.extra_config or {}).get("api_version", "2024-10-21")
        return _NativeClientWrapper(
            openai.AzureOpenAI(
                api_key=api_key,
                azure_endpoint=credential.base_url,
                api_version=api_version,
            ),
            default_model=model,  # Azure uses the deployment name as "model"
            tool_model=model,
            rate_limit_exc=openai.RateLimitError,
            bad_request_exc=openai.BadRequestError,
        )
    if provider == "anthropic":
        return AnthropicCompatClient(api_key=api_key, default_model=model)
    if provider == "google_gemini":
        return GeminiCompatClient(api_key=api_key, default_model=model)

    raise AIProviderNotConfigured(f"Unknown AI provider '{provider}'.")


def get_ai_client(firm=None):
    """
    firm=None (or a firm whose ai_provider_mode is still "platform_managed",
    the default) returns the platform's own Groq client - identical to
    every call site's behavior before this feature existed. A firm in
    "customer_managed" mode is routed through its own enabled
    AIProviderCredential; raises AIProviderNotConfigured if it has none
    (never silently falls back to the platform key).
    """
    if firm is None or firm.ai_provider_mode == "platform_managed":
        return _platform_client()

    credential = firm.ai_provider_credentials.filter(enabled=True, status="connected").first()
    if credential is None:
        raise AIProviderNotConfigured(
            "This workspace is set to Customer Managed mode but has no active AI "
            "provider connected. Ask a workspace admin to connect one in "
            "Settings → AI Configuration."
        )
    return _byok_client(credential)


def test_provider_connection(credential):
    """
    A real, lightweight live call to the provider to validate a BYOK
    credential before it can be enabled - not a format check. Never raises;
    always returns (success: bool, message: str). Used by the Settings > AI
    Configuration > API Integrations "Test Connection" action.
    """
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
        elif provider == "google_gemini":
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
