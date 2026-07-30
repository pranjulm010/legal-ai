from rag.web_search import search_legal_web

from .registry import ToolContext, ToolResult, result_json, tool


@tool(
    name="search_web",
    description=(
        "Search trusted legal web sources (courts, legal databases, legal "
        "news) for law, case law, or legal developments not found in the "
        "firm's own documents."
    ),
    parameters={
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to search for."},
        },
        "required": ["query"],
    },
)
def search_web(ctx: ToolContext, query: str) -> ToolResult:
    results = search_legal_web(query, region=ctx.region)

    if not results:
        return ToolResult(content=result_json({"found": False, "results": []}))

    payload = {
        "found": True,
        "results": [
            {
                "title": result.get("title"),
                "source_site": result.get("source_site"),
                "snippet": (result.get("snippet") or "")[:500],
            }
            for result in results
        ],
    }
    sources = [
        {
            "source_type": "web",
            "source_site": result.get("source_site"),
            "title": result.get("title"),
            "url": result.get("url"),
            "preview": (result.get("snippet") or "")[:300],
        }
        for result in results
    ]
    return ToolResult(content=result_json(payload), sources=sources)
