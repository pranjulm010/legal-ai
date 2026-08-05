"""
Modular tool registry for the chat pipeline.

A tool is one decorated function taking a ToolContext plus its own
schema-declared arguments. Registering a new tool means writing that
function in a module under chat/tools/ and importing the module in
chat/tools/__init__.py - the orchestrator never changes. Every tool that
touches firm-owned data must scope its queries to ctx.firm; the registry
enforces role permissions, so the tool list offered to the model is also
the security boundary.
"""
import inspect
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from accounts.permissions import has_permission


@dataclass
class ToolContext:
    user: Any                      # LawyerProfile of the person asking
    firm: Any
    session: Any = None            # ChatSession, if resolved
    document: Any = None           # UploadedDocument attached to the turn
    case_id: Optional[int] = None  # active case narrowed to in this session
    region: str = "usa"


@dataclass
class ToolResult:
    content: str                           # text fed back to the model
    sources: List[Dict] = field(default_factory=list)
    meta: Dict = field(default_factory=dict)


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict
    handler: Callable
    permission: Optional[str] = None


_REGISTRY: Dict[str, ToolSpec] = {}


def tool(name: str, description: str, parameters: Dict, permission: Optional[str] = None):
    def decorator(fn: Callable) -> Callable:
        _REGISTRY[name] = ToolSpec(
            name=name,
            description=description,
            parameters=parameters,
            handler=fn,
            permission=permission,
        )
        return fn

    return decorator


def available(user) -> List[ToolSpec]:
    return [
        spec
        for spec in _REGISTRY.values()
        if spec.permission is None or has_permission(user.role, spec.permission)
    ]


def groq_schemas(user) -> List[Dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": spec.name,
                "description": spec.description,
                "parameters": spec.parameters,
            },
        }
        for spec in available(user)
    ]


def dispatch(name: str, arguments: Dict, ctx: ToolContext) -> ToolResult:
    """
    Runs one tool call. Never raises: model-facing errors come back as a
    ToolResult so the tool loop can self-correct instead of crashing the
    stream.
    """
    spec = _REGISTRY.get(name)
    if spec is None:
        return ToolResult(content=f"Error: unknown tool '{name}'.")

    if spec.permission is not None and not has_permission(ctx.user.role, spec.permission):
        return ToolResult(
            content=f"Error: your role ({ctx.user.role}) is not permitted to use {name}."
        )

    # Drop hallucinated argument names instead of crashing on them.
    known = set(inspect.signature(spec.handler).parameters) - {"ctx"}
    cleaned = {k: v for k, v in (arguments or {}).items() if k in known}

    try:
        return spec.handler(ctx, **cleaned)
    except TypeError as exc:
        return ToolResult(content=f"Error: invalid arguments for {name}: {exc}")
    except Exception as exc:
        return ToolResult(content=f"Error: {name} failed: {exc}")


def result_json(data: Dict) -> str:
    """Standard serialization for structured tool output fed to the model."""
    return json.dumps(data, ensure_ascii=False, default=str)
