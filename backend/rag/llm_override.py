"""
Per-request LLM override - lets a firm's own active LLM credentials
(FirmLLMConfig) replace the platform's default Groq key/model for every
LLM call made while serving that firm's request, without threading the
firm through every call site in the rag package.

JWTAuth stamps the authenticated firm id into a contextvar at the start
of each request; get_override() then lazily resolves (and caches for the
rest of the request) that firm's active, routable config the first time
an LLM call actually happens, so requests that never touch the LLM pay
no extra query.
"""

from contextvars import ContextVar
from typing import Optional

# The firm whose request is currently being served (None = unauthenticated
# or no firm context).
_current_firm_id: ContextVar[Optional[int]] = ContextVar("llm_current_firm_id", default=None)

# Memoized lookup result for _current_firm_id: (firm_id, config-or-None).
_resolved: ContextVar[Optional[tuple]] = ContextVar("llm_resolved_config", default=None)


def set_request_firm(firm_id: Optional[int]) -> None:
    """Called by JWTAuth on every authenticated request. Always set (even to
    None) so a recycled worker thread never leaks the previous request's
    firm into this one."""
    _current_firm_id.set(firm_id)
    _resolved.set(None)


def get_override():
    """
    Returns the current firm's active FirmLLMConfig for a routable
    provider, or None to use the platform default. Fails open (None) on
    any lookup error - a broken override must never take the pipeline down.
    """
    firm_id = _current_firm_id.get()
    if firm_id is None:
        return None

    cached = _resolved.get()
    if cached is not None and cached[0] == firm_id:
        return cached[1]

    try:
        from accounts.models import FirmLLMConfig

        config = FirmLLMConfig.objects.filter(
            firm_id=firm_id,
            is_active=True,
            provider__in=FirmLLMConfig.ROUTABLE_PROVIDERS,
        ).first()
    except Exception:
        config = None

    _resolved.set((firm_id, config))
    return config
