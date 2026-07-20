"""
Translation shims for the two BYOK providers whose native API doesn't
already speak OpenAI's chat-completions wire format (Groq, OpenAI, Mistral,
and Azure OpenAI all do - see llm_client.py, they need zero translation).

Every shim exposes `.chat.completions.create(model=, messages=, tools=,
tool_choice=, temperature=, max_tokens=, response_format=)` and returns an
object shaped like `openai.types.chat.ChatCompletion` far enough for the
existing call sites (`response.choices[0].message.content`,
`response.choices[0].message.tool_calls[i].id/.function.name/.function.arguments`
- see research_agent.py ~line 1047) to work completely unchanged. `messages`
in and the returned tool_calls' `.function.arguments` are both the same
OpenAI shape used everywhere else in this codebase, so callers never need to
know which provider actually served the request.
"""

import json
import uuid
from typing import Dict, List, Optional

import anthropic
import requests

from .llm_errors import AIBadRequestError, AIRateLimitError


class _ToolFunction:
    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments


class _ToolCall:
    def __init__(self, id_: str, name: str, arguments: str):
        self.id = id_
        self.type = "function"
        self.function = _ToolFunction(name, arguments)


class _Message:
    def __init__(self, content: Optional[str], tool_calls: Optional[List[_ToolCall]] = None):
        self.content = content
        self.tool_calls = tool_calls


class _Choice:
    def __init__(self, message: _Message):
        self.message = message


class _ChatCompletion:
    def __init__(self, choices: List[_Choice]):
        self.choices = choices


class ChatNamespace:
    def __init__(self, completions):
        self.completions = completions


# ---------------------------------------------------------------------------
# Anthropic
# ---------------------------------------------------------------------------


class _AnthropicCompletions:
    def __init__(self, client: "anthropic.Anthropic"):
        self._client = client

    def create(
        self,
        model: str,
        messages: List[Dict],
        tools: Optional[List[Dict]] = None,
        tool_choice=None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        response_format: Optional[Dict] = None,
        **_ignored,
    ):
        system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
        if response_format and response_format.get("type") == "json_object":
            system_parts.append(
                "Respond with ONLY a single valid JSON object and no other text, "
                "markdown formatting, or commentary."
            )
        system_prompt = "\n\n".join(system_parts) or None

        anthropic_messages = []
        for message in messages:
            role = message.get("role")
            if role == "system":
                continue
            if role == "user":
                anthropic_messages.append({"role": "user", "content": message.get("content") or ""})
            elif role == "assistant":
                if message.get("tool_calls"):
                    content = []
                    if message.get("content"):
                        content.append({"type": "text", "text": message["content"]})
                    for tool_call in message["tool_calls"]:
                        try:
                            tool_input = json.loads(tool_call["function"]["arguments"] or "{}")
                        except json.JSONDecodeError:
                            tool_input = {}
                        content.append(
                            {
                                "type": "tool_use",
                                "id": tool_call["id"],
                                "name": tool_call["function"]["name"],
                                "input": tool_input,
                            }
                        )
                    anthropic_messages.append({"role": "assistant", "content": content})
                else:
                    anthropic_messages.append({"role": "assistant", "content": message.get("content") or ""})
            elif role == "tool":
                anthropic_messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": message["tool_call_id"],
                                "content": message.get("content") or "",
                            }
                        ],
                    }
                )

        anthropic_tools = None
        if tools:
            anthropic_tools = [
                {
                    "name": t["function"]["name"],
                    "description": t["function"].get("description", ""),
                    "input_schema": t["function"].get("parameters") or {"type": "object", "properties": {}},
                }
                for t in tools
                if t.get("type") == "function"
            ]

        kwargs = dict(
            model=model,
            messages=anthropic_messages,
            max_tokens=max_tokens or 1024,
            temperature=temperature if temperature is not None else 1.0,
        )
        if system_prompt:
            kwargs["system"] = system_prompt
        if anthropic_tools:
            kwargs["tools"] = anthropic_tools

        try:
            response = self._client.messages.create(**kwargs)
        except anthropic.RateLimitError as error:
            raise AIRateLimitError(str(error)) from error
        except anthropic.BadRequestError as error:
            raise AIBadRequestError(str(error)) from error

        text_parts = []
        tool_calls = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)
            elif block.type == "tool_use":
                tool_calls.append(_ToolCall(block.id, block.name, json.dumps(block.input)))

        message = _Message(
            content="\n".join(text_parts) if text_parts else None,
            tool_calls=tool_calls or None,
        )
        return _ChatCompletion(choices=[_Choice(message)])


class AnthropicCompatClient:
    def __init__(self, api_key: str, default_model: str):
        client = anthropic.Anthropic(api_key=api_key)
        self.chat = ChatNamespace(_AnthropicCompletions(client))
        self.default_model = default_model
        self.tool_model = default_model


# ---------------------------------------------------------------------------
# Google Gemini - via the raw Generative Language REST API, not the
# google-generativeai SDK. That SDK's API key is set through a process-wide
# genai.configure(api_key=...) call, which is unsafe here: different firms'
# BYOK requests can run concurrently in the same process with different
# customer keys, and a global default would risk one firm's request using
# another firm's key. Talking to the documented REST endpoint directly with
# `requests` (already a dependency) keeps the key strictly request-scoped.
# ---------------------------------------------------------------------------

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class _GeminiCompletions:
    def __init__(self, api_key: str):
        self._api_key = api_key

    def create(
        self,
        model: str,
        messages: List[Dict],
        tools: Optional[List[Dict]] = None,
        tool_choice=None,
        temperature: float = 0.2,
        max_tokens: int = 1024,
        response_format: Optional[Dict] = None,
        **_ignored,
    ):
        system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]

        # id -> function name, so a later {"role": "tool", "tool_call_id": ...}
        # message can be translated into Gemini's functionResponse, which
        # keys by name rather than by call id.
        call_id_to_name: Dict[str, str] = {}

        contents = []
        for message in messages:
            role = message.get("role")
            if role == "system":
                continue
            if role == "user":
                contents.append({"role": "user", "parts": [{"text": message.get("content") or ""}]})
            elif role == "assistant":
                if message.get("tool_calls"):
                    parts = []
                    if message.get("content"):
                        parts.append({"text": message["content"]})
                    for tool_call in message["tool_calls"]:
                        name = tool_call["function"]["name"]
                        call_id_to_name[tool_call["id"]] = name
                        try:
                            args = json.loads(tool_call["function"]["arguments"] or "{}")
                        except json.JSONDecodeError:
                            args = {}
                        parts.append({"functionCall": {"name": name, "args": args}})
                    contents.append({"role": "model", "parts": parts})
                else:
                    contents.append({"role": "model", "parts": [{"text": message.get("content") or ""}]})
            elif role == "tool":
                name = call_id_to_name.get(message.get("tool_call_id"), "unknown_function")
                contents.append(
                    {
                        "role": "function",
                        "parts": [
                            {
                                "functionResponse": {
                                    "name": name,
                                    "response": {"result": message.get("content") or ""},
                                }
                            }
                        ],
                    }
                )

        body: Dict = {
            "contents": contents,
            "generationConfig": {
                "temperature": temperature if temperature is not None else 0.7,
                "maxOutputTokens": max_tokens or 1024,
            },
        }
        if system_parts:
            body["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}
        if response_format and response_format.get("type") == "json_object":
            body["generationConfig"]["responseMimeType"] = "application/json"
        if tools:
            declarations = [
                {
                    "name": t["function"]["name"],
                    "description": t["function"].get("description", ""),
                    "parameters": t["function"].get("parameters") or {"type": "object", "properties": {}},
                }
                for t in tools
                if t.get("type") == "function"
            ]
            body["tools"] = [{"functionDeclarations": declarations}]

        response = requests.post(
            f"{_GEMINI_BASE_URL}/models/{model}:generateContent",
            headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
            json=body,
            timeout=60,
        )

        if response.status_code == 429:
            raise AIRateLimitError(response.text)
        if response.status_code == 400:
            raise AIBadRequestError(response.text)
        response.raise_for_status()

        data = response.json()
        candidates = data.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []

        text_parts = []
        tool_calls = []
        for part in parts:
            if "text" in part:
                text_parts.append(part["text"])
            elif "functionCall" in part:
                call = part["functionCall"]
                call_id = f"call_{uuid.uuid4().hex[:12]}"
                tool_calls.append(_ToolCall(call_id, call.get("name", ""), json.dumps(call.get("args", {}))))

        message = _Message(
            content="\n".join(text_parts) if text_parts else None,
            tool_calls=tool_calls or None,
        )
        return _ChatCompletion(choices=[_Choice(message)])


class GeminiCompatClient:
    def __init__(self, api_key: str, default_model: str):
        self.chat = ChatNamespace(_GeminiCompletions(api_key))
        self.default_model = default_model
        self.tool_model = default_model
