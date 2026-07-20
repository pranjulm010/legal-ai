"""
AIProviderResolver - the single source of truth for "which AI credentials
should this request use." Reusable from request-handling code (which reads
the current request's workspace via ai_provider.context, set by
AIProviderContextMiddleware) or programmatic/offline code (which can pass
workspace_id explicitly, e.g. a management command or test).

Existing AI modules (rag/groq_client.py's get_groq_client() - the ONLY
integration point) receive just the resolved client object. They never
know, and never need to know, whether it's the platform's own Groq key or
a workspace's own BYOK credential for any of the 6 supported providers.
"""

from django.conf import settings

from .context import get_current_workspace_id
from .encryption import decrypt_secret
from .models import WorkspaceAIConfiguration, WorkspaceAPIKey
from .providers import AnthropicClient, GeminiClient, ModelOverrideClient

_DEFAULT_MODELS = {
    "groq": None,  # filled from settings.GROQ_MODEL below
    "openai": "gpt-4o",
    "anthropic": "claude-sonnet-4-5",
    "gemini": "gemini-2.0-flash",
    "azure_openai": "",  # deployment name - no sensible generic default
    "mistral": "mistral-large-latest",
}


class AIProviderNotConfigured(Exception):
    """
    Raised when a workspace is Customer Managed but has no enabled,
    connected credential. Callers (the new Settings endpoints) turn this
    into a clean 4xx. get_groq_client() itself lets this propagate
    exactly like its existing ValueError("GROQ_API_KEY is missing") case
    already does today for a missing platform key - unchanged behavior
    shape, just a different message for a different situation.
    """


class AIProviderResolver:
    def __init__(self, workspace_id=None):
        self.workspace_id = workspace_id if workspace_id is not None else get_current_workspace_id()

    def resolve(self):
        """
        Returns an object exposing `.chat.completions.create(...)` -
        exactly what rag/groq_client.get_groq_client() has always
        returned (today, always a real `groq.Groq` instance). Platform
        mode returns that same real, unwrapped Groq client - byte-
        identical to current behavior. Customer mode returns a thin
        wrapper around the workspace's own provider (see
        ai_provider/providers.py) that still speaks the same shape.
        """
        import groq

        configuration = self._get_configuration()

        if configuration is None or configuration.provider_mode == WorkspaceAIConfiguration.PLATFORM:
            if not settings.GROQ_API_KEY:
                raise ValueError("GROQ_API_KEY is missing in .env file.")
            return groq.Groq(api_key=settings.GROQ_API_KEY)

        credential = WorkspaceAPIKey.objects.filter(
            workspace_id=self.workspace_id, enabled=True, status="connected"
        ).first()
        if credential is None:
            raise AIProviderNotConfigured(
                "This workspace is set to Customer Managed mode but has no active AI "
                "provider connected. Ask a workspace admin to connect one in "
                "Settings > AI Configuration."
            )
        return self._build_customer_client(credential)

    def _get_configuration(self):
        if self.workspace_id is None:
            return None
        return WorkspaceAIConfiguration.objects.filter(workspace_id=self.workspace_id).first()

    def _build_customer_client(self, credential: WorkspaceAPIKey):
        import groq
        import openai

        provider = credential.provider
        api_key = decrypt_secret(credential.encrypted_api_key)
        resolved_model = credential.model or (
            settings.GROQ_MODEL if provider == "groq" else _DEFAULT_MODELS.get(provider, "")
        )

        if provider == "groq":
            return ModelOverrideClient(
                groq.Groq(api_key=api_key), resolved_model, groq.RateLimitError, groq.BadRequestError
            )
        if provider == "openai":
            return ModelOverrideClient(
                openai.OpenAI(api_key=api_key), resolved_model, openai.RateLimitError, openai.BadRequestError
            )
        if provider == "mistral":
            return ModelOverrideClient(
                openai.OpenAI(api_key=api_key, base_url="https://api.mistral.ai/v1"),
                resolved_model,
                openai.RateLimitError,
                openai.BadRequestError,
            )
        if provider == "azure_openai":
            api_version = (credential.extra_config or {}).get("api_version", "2024-10-21")
            return ModelOverrideClient(
                openai.AzureOpenAI(api_key=api_key, azure_endpoint=credential.base_url, api_version=api_version),
                resolved_model,
                openai.RateLimitError,
                openai.BadRequestError,
            )
        if provider == "anthropic":
            return AnthropicClient(api_key=api_key, resolved_model=resolved_model)
        if provider == "gemini":
            return GeminiClient(api_key=api_key, resolved_model=resolved_model)

        raise AIProviderNotConfigured(f"Unknown AI provider '{provider}'.")


def get_resolved_ai_client():
    """Convenience wrapper - the one line rag/groq_client.get_groq_client()
    needs to add."""
    return AIProviderResolver().resolve()
