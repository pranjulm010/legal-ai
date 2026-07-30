// SSE client for the chat pipeline (POST /api/chat/stream/). Uses fetch +
// ReadableStream because EventSource can't send POST bodies or an
// Authorization header. Event names mirror backend/chat/streaming.py.
import { BASE_URL } from "./api";
import { getAccessToken, getRefreshToken, setAccessToken } from "./auth";
import axios from "axios";

export interface ChatStreamPayload {
  question: string;
  chat_session_id?: number | null;
  document_id?: string | null;
  case_id?: number | null;
  region?: string | null;
}

export interface ToolCallEvent {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultEvent {
  id: string;
  name: string;
  summary: string;
  sources: Record<string, unknown>[];
}

export interface FinalMessageEvent {
  chat_id: number;
  chat_session_id: number;
  answer: string;
  route: string;
  sources: Record<string, unknown>[];
  research_steps: {
    tool: string;
    sub_question: string;
    source_type: string;
    resolved: boolean;
  }[];
}

export interface ChatStreamHandlers {
  onSession?: (data: { chat_session_id: number; title: string }) => void;
  onStatus?: (data: { stage: string; label: string }) => void;
  onToolCall?: (data: ToolCallEvent) => void;
  onToolResult?: (data: ToolResultEvent) => void;
  onToken?: (data: { text: string }) => void;
  onMessage?: (data: FinalMessageEvent) => void;
  onError?: (data: { error: string }) => void;
  onDone?: () => void;
}

const refreshAccessToken = async (): Promise<string | null> => {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  try {
    const response = await axios.post(`${BASE_URL}/auth/refresh/`, { refresh });
    const newAccess = response.data.access as string;
    setAccessToken(newAccess);
    return newAccess;
  } catch {
    return null;
  }
};

const openStream = async (
  payload: ChatStreamPayload,
  token: string,
  signal?: AbortSignal
): Promise<Response> =>
  fetch(`${BASE_URL}/chat/stream/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal,
  });

export async function streamChat(
  payload: ChatStreamPayload,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  let token = getAccessToken() || "";
  let response = await openStream(payload, token, signal);

  if (response.status === 401) {
    const newAccess = await refreshAccessToken();
    if (!newAccess) throw new Error("Not authenticated");
    response = await openStream(payload, newAccess, signal);
  }

  if (!response.ok || !response.body) {
    throw new Error(`Chat stream failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (rawEvent: string) => {
    let eventName = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length === 0) return;

    let data: any;
    try {
      data = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }

    switch (eventName) {
      case "session":
        handlers.onSession?.(data);
        break;
      case "status":
        handlers.onStatus?.(data);
        break;
      case "tool_call":
        handlers.onToolCall?.(data);
        break;
      case "tool_result":
        handlers.onToolResult?.(data);
        break;
      case "token":
        handlers.onToken?.(data);
        break;
      case "message":
        handlers.onMessage?.(data);
        break;
      case "error":
        handlers.onError?.(data);
        break;
      case "done":
        handlers.onDone?.();
        break;
    }
  };

  // SSE frames are separated by a blank line; a frame can be split across
  // network chunks, so accumulate and only dispatch completed frames.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const rawEvent = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      if (rawEvent.trim()) dispatch(rawEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}
