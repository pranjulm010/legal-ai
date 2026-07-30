"""
Groq client/model resolution, honoring a firm's own key/model override
(see rag.llm_override). Everything else that used to live here - the
classifiers, answer generators, and prompt fragments - moved into the
chat pipeline (backend/chat/) or was removed with the legacy pipeline.
"""
from django.conf import settings
from groq import Groq

from .llm_override import get_override


def get_groq_client():
    # A firm with its own active Groq credentials runs on those instead of
    # the platform's key (see rag.llm_override for how the firm gets here).
    override = get_override()
    if override is not None and override.provider == "groq":
        return Groq(api_key=override.api_key)

    if not settings.GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is missing in .env file.")

    return Groq(api_key=settings.GROQ_API_KEY)


def get_groq_model() -> str:
    """The model every LLM call should use for the current request: the
    firm's own model override when one is active, else the platform
    default. Call sites use this instead of settings.GROQ_MODEL directly."""
    override = get_override()
    if override is not None and override.provider == "groq" and override.model_name:
        return override.model_name

    return settings.GROQ_MODEL
