"""
Client wrappers returned by AIProviderResolver. Every wrapper exposes the
exact same shape rag/groq_client.py's get_groq_client() has always
returned - `.chat.completions.create(model=, messages=, tools=,
tool_choice=, temperature=, max_tokens=, response_format=)` returning an
object with `.choices[0].message.content` and (for tool calls)
`.choices[0].message.tool_calls[i].id/.function.name/.function.arguments` -
so swapping the return value of get_groq_client() is a drop-in
replacement. No caller anywhere in rag/*.py changes shape or gains a new
parameter.

Two things make this work without touching research_agent.py, drafting.py,
firm_stats.py, or any other existing rag/*.py file:

1. MODEL OVERRIDE: every unchanged call site still passes
   `model=settings.GROQ_MODEL` (a Groq-specific model id, since that line
   of code never changes) even when routed to a completely different
   provider. `_ModelOverridingCompletions` and the Anthropic/Gemini shims
   below silently substitute the workspace's OWN configured model instead
   of whatever was passed in - the provider decision genuinely lives
   entirely inside the resolved client, exactly as the "existing AI
   modules should only receive the resolved provider" requirement asks.

2. ERROR TRANSLATION: research_agent.py has hardcoded
   `except groq.RateLimitError` / `except groq.BadRequestError` clauses
   that must keep working even when a BYOK request actually failed against
   OpenAI/Anthropic/Gemini/Mistral/Azure. Every wrapper here catches that
   provider's own native rate-limit/bad-request exception and re-raises it
   AS a real `groq.RateLimitError`/`groq.BadRequestError` (constructed
   with a synthetic httpx.Response) - the exact types research_agent.py's
   unmodified except clauses already catch - so its existing retry/
   graceful-degradation behavior keeps working untouched for every
   provider, not just Groq.
"""

import httpx
import groq


def _as_groq_rate_limit_error(message: str) -> groq.RateLimitError:
    response = httpx.Response(status_code=429, request=httpx.Request("POST", "https://example.com"))
    return groq.RateLimitError(message, response=response, body=None)


def _as_groq_bad_request_error(message: str) -> groq.BadRequestError:
    response = httpx.Response(status_code=400, request=httpx.Request("POST", "https://example.com"))
    return groq.BadRequestError(message, response=response, body=None)


class _ChatNamespace:
    def __init__(self, completions):
        self.completions = completions


class _ToolFunction:
    def __init__(self, name, arguments):
        self.name = name
        self.arguments = arguments


class _ToolCall:
    def __init__(self, id_, name, arguments):
        self.id = id_
        self.type = "function"
        self.function = _ToolFunction(name, arguments)


class _Message:
    def __init__(self, content, tool_calls=None):
        self.content = content
        self.tool_calls = tool_calls


class _Choice:
    def __init__(self, message):
        self.message = message


class _ChatCompletion:
    def __init__(self, choices):
        self.choices = choices


class _ModelOverridingCompletions:
    """
    Wraps any OpenAI-wire-compatible native client (groq.Groq,
    openai.OpenAI, openai.AzureOpenAI - Groq, OpenAI, Mistral, and Azure
    OpenAI all speak this same wire format, so no translation is needed,
    only model substitution and error normalization).
    """

    def __init__(self, native_client, resolved_model, rate_limit_exc, bad_request_exc):
        self._client = native_client
        self._resolved_model = resolved_model
        self._rate_limit_exc = rate_limit_exc
        self._bad_request_exc = bad_request_exc

    def create(self, **kwargs):
        kwargs = dict(kwargs)
        kwargs["model"] = self._resolved_model  # override whatever unchanged caller code passed
        try:
            return self._client.chat.completions.create(**kwargs)
        except self._rate_limit_exc as error:
            raise _as_groq_rate_limit_error(str(error)) from error
        except self._bad_request_exc as error:
            raise _as_groq_bad_request_error(str(error)) from error


class ModelOverrideClient:
    def __init__(self, native_client, resolved_model, rate_limit_exc, bad_request_exc):
        self.chat = _ChatNamespace(
            _ModelOverridingCompletions(native_client, resolved_model, rate_limit_exc, bad_request_exc)
        )


class _AnthropicCompletions:
    def __init__(self, anthropic_client, resolved_model):
        self._client = anthropic_client
        self._resolved_model = resolved_model

    def create(self, messages, tools=None, temperature=0.2, max_tokens=1024, response_format=None, **_ignored):
        import anthropic
        import json

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
        tools = tools or None
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
            model=self._resolved_model,
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
            raise _as_groq_rate_limit_error(str(error)) from error
        except anthropic.BadRequestError as error:
            raise _as_groq_bad_request_error(str(error)) from error

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


class AnthropicClient:
    def __init__(self, api_key, resolved_model):
        import anthropic

        native = anthropic.Anthropic(api_key=api_key)
        self.chat = _ChatNamespace(_AnthropicCompletions(native, resolved_model))


_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"


class _GeminiCompletions:
    """
    Talks to the raw Generative Language REST API rather than the
    google-generativeai SDK - that SDK's API key is set via a process-wide
    genai.configure() call, unsafe when concurrent requests from different
    workspaces use different customer keys. `requests` (already a
    dependency) keeps the key strictly request-scoped.
    """

    def __init__(self, api_key, resolved_model):
        self._api_key = api_key
        self._resolved_model = resolved_model

    def create(self, messages, tools=None, temperature=0.2, max_tokens=1024, response_format=None, **_ignored):
        import json
        import uuid

        import requests

        system_parts = [m["content"] for m in messages if m.get("role") == "system" and m.get("content")]
        call_id_to_name = {}

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
                        "parts": [{"functionResponse": {"name": name, "response": {"result": message.get("content") or ""}}}],
                    }
                )

        body = {
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
            f"{_GEMINI_BASE_URL}/models/{self._resolved_model}:generateContent",
            headers={"x-goog-api-key": self._api_key, "Content-Type": "application/json"},
            json=body,
            timeout=60,
        )

        if response.status_code == 429:
            raise _as_groq_rate_limit_error(response.text)
        if response.status_code == 400:
            raise _as_groq_bad_request_error(response.text)
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


class GeminiClient:
    def __init__(self, api_key, resolved_model):
        self.chat = _ChatNamespace(_GeminiCompletions(api_key, resolved_model))
