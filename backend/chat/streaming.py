"""
Server-Sent Events encoding for the chat stream. Event names are the
frontend contract (see frontend/lib/chatStream.ts):
session, status, tool_call, tool_result, token, message, error, done.
"""
import json
from typing import Dict


def sse(event: str, data: Dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n".encode(
        "utf-8"
    )
