"""
LLM client/model resolution, honoring a firm's own key/model override (see
rag.llm_override). Every call site gets back something with the same
OpenAI-Chat-Completions-shaped interface (`.chat.completions.create(...)`,
`response.choices[0].message`, streaming chunks with
`chunk.choices[0].delta.content`) no matter which provider is actually
serving the request:

- groq: the native Groq SDK - the platform's own default, and what every
  call site was written against originally.
- openai: the native OpenAI SDK - same interface as Groq's already, no
  translation needed.
- anthropic / gemini: routed through litellm, which translates their very
  different native APIs (message roles, tool-schema format, streaming
  event types) into this same OpenAI-shaped interface so nothing above
  this module has to know the difference.
"""
from django.conf import settings
from groq import Groq
from openai import OpenAI

from .llm_override import get_override

# Fallback model used when a firm activates a provider but leaves the
# "Model" field blank.
_DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5",
    "gemini": "gemini-3.5-flash",
}
# litellm routes on a "<provider>/<model>" prefixed model string.
_LITELLM_PREFIX = {
    "anthropic": "anthropic",
    "gemini": "gemini",
}


class _LiteLLMCompletions:
    def __init__(self, provider: str, api_key: str):
        self._prefix = _LITELLM_PREFIX[provider]
        self._api_key = api_key

    def create(self, *, model, **kwargs):
        import litellm

        return litellm.completion(
            model=f"{self._prefix}/{model}", api_key=self._api_key, **kwargs
        )


class _LiteLLMClient:
    """Minimal shim so litellm-routed providers drop into call sites
    written for `client.chat.completions.create(...)`."""

    def __init__(self, provider: str, api_key: str):
        self.chat = self
        self.completions = _LiteLLMCompletions(provider, api_key)


def get_groq_client():
    # A firm with its own active credentials runs on those instead of the
    # platform's key (see rag.llm_override for how the firm gets here).
    override = get_override()
    if override is not None:
        if override.provider == "groq":
            return Groq(api_key=override.api_key)
        if override.provider == "openai":
            return OpenAI(api_key=override.api_key)
        if override.provider in _LITELLM_PREFIX:
            return _LiteLLMClient(override.provider, override.api_key)

    if not settings.GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is missing in .env file.")

    return Groq(api_key=settings.GROQ_API_KEY)


def get_groq_model() -> str:
    """The model every LLM call should use for the current request: the
    firm's own model override when one is active, else the platform
    default. Call sites use this instead of settings.GROQ_MODEL directly."""
    override = get_override()
    if override is not None:
        return override.model_name or _DEFAULT_MODELS.get(override.provider, settings.GROQ_MODEL)

    return settings.GROQ_MODEL


def get_fast_model() -> str:
    """Model for cheap/auxiliary calls (intent detection, memory
    extraction, style summaries). Only the platform's own Groq key has a
    dedicated fast model configured - a firm running its own key/model
    uses that same model for everything, since it's not the platform
    footing the bill."""
    override = get_override()
    if override is not None:
        return get_groq_model()

    return settings.GROQ_FAST_MODEL
