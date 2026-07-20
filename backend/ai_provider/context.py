"""
Request-scoped storage for "which workspace is this request for", set once
per request by AIProviderContextMiddleware and read by AIProviderResolver.

This exists so rag/groq_client.py's get_groq_client() can resolve the
correct AI credentials WITHOUT any function in rag/*.py needing to accept
and thread a new `workspace`/`firm` parameter - the one hard constraint of
this feature (see the AI Provider Mode plan). contextvars.ContextVar is
async- and thread-safe per-request isolation, unlike a plain module-level
global.
"""

import contextvars

_current_workspace_id: "contextvars.ContextVar[int | None]" = contextvars.ContextVar(
    "ai_provider_current_workspace_id", default=None
)


def set_current_workspace_id(workspace_id):
    return _current_workspace_id.set(workspace_id)


def reset_current_workspace_id(token):
    _current_workspace_id.reset(token)


def get_current_workspace_id():
    return _current_workspace_id.get()
