# Importing a tool module registers its @tool functions; the registry is
# the single place the orchestrator reads from.
from . import cases, compare, documents, drafting, firm, forms, web  # noqa: F401
from .registry import (  # noqa: F401
    ToolContext,
    ToolResult,
    available,
    dispatch,
    groq_schemas,
)
