class AIRateLimitError(Exception):
    """Normalized 429 from any provider - see llm_client.get_ai_client()."""


class AIBadRequestError(Exception):
    """Normalized 4xx (malformed request/tool call, etc.) from any provider."""


class AIProviderNotConfigured(Exception):
    """
    Raised when a firm is in customer_managed mode but has no enabled,
    connected AIProviderCredential - callers must turn this into a clean
    4xx explaining the situation, never silently fall back to the
    platform's own key (that would violate the whole point of BYOK mode).
    """
