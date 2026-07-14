"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import {
  deleteChatSession as deleteChatSessionApi,
  getChatSession,
  listChatSessions,
  REGIONS,
  renameChatSession as renameChatSessionApi,
  searchChatHistory,
  sendMessage as sendMessageApi,
  uploadDocument as uploadDocumentApi,
  waitForDocumentReady,
  type ChatSearchResult,
  type ChatSessionListItem,
  type ResearchStep,
  type ResponseMode,
  type UploadDocumentResponse,
} from "@/lib/api";

type AnswerMode = "plain" | "mixed" | "expert";

type SourceItem = {
  source_type?: string;
  document_id?: string;
  document_name?: string;
  document_source?: string;
  page_number?: number | null;
  confidence_percent?: number | null;
  source_site?: string;
  title?: string;
  url?: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  answerMode?: AnswerMode;
  documentName?: string;
  timestamp: Date;
  awaitingWebConfirm?: boolean;
  originalQuestion?: string;
  researchSteps?: ResearchStep[] | null;
  sources?: SourceItem[];
  route?: string | null;
  confidenceLevel?: string | null;
};

const ROUTE_LABELS: Record<string, string> = {
  uploaded_document: "Uploaded Document",
  firm_database: "Firm Database",
  web_search: "Trusted Web Search",
  llm_knowledge: "General AI Knowledge",
};

const ANSWER_MODES: {
  value: AnswerMode;
  label: string;
  icon: string;
  desc: string;
}[] = [
  {
    value: "plain",
    label: "Plain English",
    icon: "👤",
    desc: "For citizens/public users",
  },
  {
    value: "mixed",
    label: "Mixed Mode",
    icon: "🧾",
    desc: "Simple + legal terms",
  },
  {
    value: "expert",
    label: "Expert Mode",
    icon: "⚖️",
    desc: "For lawyers/professionals",
  },
];

const SUGGESTED_QUESTIONS = [
  { text: "My phone was stolen. What legal steps should I take now?", icon: "📱" },
  { text: "Help me understand this FIR and what the next steps are.", icon: "📄" },
  { text: "Find Supreme Court precedents on anticipatory bail.", icon: "⚖️" },
  { text: "Explain Article 21 of the Indian Constitution in simple language.", icon: "📚" },
];

function getModeLabel(mode: AnswerMode) {
  return ANSWER_MODES.find((m) => m.value === mode)?.label || "Plain English";
}

function toBackendMode(mode: AnswerMode): ResponseMode {
  if (mode === "plain") return "plain_english";
  if (mode === "expert") return "professional";
  return "mixed";
}

function extractAnswer(data: any): string {
  return (
    data?.answer ||
    data?.response ||
    data?.message ||
    data?.data?.answer ||
    "I could not process that request. Please try again."
  );
}

function FormattedMessage({ content }: { content: string }) {
  const lines = content.split("\n");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {lines.map((line, index) => {
        if (line.startsWith("## ")) {
          return (
            <h3
              key={index}
              style={{
                margin: "8px 0 0",
                color: "#c9a96e",
                fontSize: 15,
                fontWeight: 800,
              }}
            >
              {line.slice(3)}
            </h3>
          );
        }

        if (line.startsWith("### ")) {
          return (
            <h4
              key={index}
              style={{
                margin: "6px 0 0",
                color: "#e2d5b8",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              {line.slice(4)}
            </h4>
          );
        }

        if (line.startsWith("- ") || line.startsWith("• ")) {
          return (
            <div
              key={index}
              style={{
                display: "flex",
                gap: 9,
                paddingLeft: 4,
                color: "#cfc0a4",
                lineHeight: 1.7,
                fontSize: 13.5,
              }}
            >
              <span style={{ color: "#c9a96e" }}>▸</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        }

        if (!line.trim()) return <div key={index} style={{ height: 4 }} />;

       // Professional heading support
if (line.match(/^\*\*(.*?)\*\*:?\s*$/)) {
  const heading = line.replace(/\*\*/g, "").replace(":", "");

  return (
    <div
      key={index}
      style={{
        marginTop: 14,
        marginBottom: 6,
        fontSize: 14,
        fontWeight: 700,
        color: "#f2dfb5",
        letterSpacing: "0.2px",
      }}
    >
      {heading}
    </div>
  );
}

// Bold inline support
const formattedLine = line.split(/(\*\*.*?\*\*)/g);

return (
  <p
    key={index}
    style={{
      margin: 0,
      color: "#d2c4a8",
      lineHeight: 1.8,
      fontSize: 14,
    }}
  >
    {formattedLine.map((part, idx) => {
      const isBold =
        part.startsWith("**") && part.endsWith("**");

      return isBold ? (
        <strong
          key={idx}
          style={{
            color: "#f2dfb5",
            fontWeight: 700,
          }}
        >
          {part.replace(/\*\*/g, "")}
        </strong>
      ) : (
        <span key={idx}>{part}</span>
      );
    })}
  </p>
);
      })}
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", gap: 5, padding: "5px 0" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#c9a96e",
            animation: `typingBounce 1.3s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

export default function LexoraLegalChatPage() {
  const router = useRouter();
  const { user, isLoading: authLoading, logout } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("plain");

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [documentProcessing, setDocumentProcessing] = useState(false);
  const [isListening,setIsListening]=useState(false)
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [useAgent, setUseAgent] = useState(false);
  const [region, setRegion] = useState("india");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [resumingSession, setResumingSession] = useState(false);
  const [chatSessions, setChatSessions] = useState<ChatSessionListItem[]>([]);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyResults, setHistoryResults] = useState<ChatSearchResult[] | null>(null);
  const [searchingHistory, setSearchingHistory] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const refreshSessions = useCallback(() => {
    listChatSessions()
      .then(setChatSessions)
      .catch((error) => console.error("Failed to load chat sessions:", error));
  }, []);

  const loadSession = useCallback((sessionId: number, updateUrl: boolean = true) => {
    setResumingSession(true);

    getChatSession(sessionId)
      .then((session) => {
        setActiveSessionId(session.id);
        if (session.document_id) {
          setDocumentId(session.document_id);
          setDocumentName(session.document_name);
        } else {
          setDocumentId(null);
          setDocumentName(null);
        }
        setMessages(
          session.messages.flatMap((m) => [
            {
              id: `${m.id}-q`,
              role: "user" as const,
              content: m.question,
              timestamp: new Date(m.created_at),
            },
            {
              id: `${m.id}-a`,
              role: "assistant" as const,
              content: m.answer,
              timestamp: new Date(m.created_at),
            },
          ])
        );
        if (updateUrl) {
          window.history.replaceState({}, "", `/app?session=${session.id}`);
        }
      })
      .catch((error) => {
        console.error("Failed to load chat session:", error);
        const message =
          error?.response?.data?.error ||
          "Couldn't load that chat - it may no longer be resumable.";
        setMessages([
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: message,
            timestamp: new Date(),
          },
        ]);
        window.history.replaceState({}, "", "/app");
      })
      .finally(() => setResumingSession(false));
  }, []);

  // Resuming a chat from the Knowledge page - hydrate this session's full
  // message history and keep sending follow-ups into the same thread.
  useEffect(() => {
    refreshSessions();

    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get("session");
    if (!sessionParam) return;

    const sessionId = Number(sessionParam);
    if (!Number.isFinite(sessionId)) return;

    loadSession(sessionId, false);
  }, [loadSession, refreshSessions]);

  const uploadDocument = async (file: File) => {
    if (!file) return;

    setUploading(true);

    try {
      // API route is handled only inside api.ts
      const data: UploadDocumentResponse = await uploadDocumentApi(
        file,
        "anonymous"
      );

      const newDocumentId =
        data.document_id || data.documentId || data.id || crypto.randomUUID();

      const newDocumentName =
        data.file_name || data.filename || data.name || file.name;

      setDocumentId(newDocumentId);
      setDocumentName(newDocumentName);

      if (data.status === "processing") {
        setDocumentProcessing(true);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Document uploaded: ${newDocumentName}\n\nProcessing in the background (large files can take a little while) - I'll let you know the moment it's ready to ask questions about.`,
            timestamp: new Date(),
            documentName: newDocumentName,
          },
        ]);

        try {
          const finalStatus = await waitForDocumentReady(newDocumentId);

          if (finalStatus.status === "ready") {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `${newDocumentName} is ready. Ask any question and I'll use this document, firm search, web retrieval, and LLM reasoning as needed.`,
                timestamp: new Date(),
                documentName: newDocumentName,
              },
            ]);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                content: `Sorry, I couldn't process ${newDocumentName}.${finalStatus.error_message ? ` (${finalStatus.error_message})` : ""} Please try uploading it again.`,
                timestamp: new Date(),
              },
            ]);
            setDocumentId(null);
            setDocumentName(null);
          }
        } catch (pollError) {
          console.error("Document status polling error:", pollError);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `${newDocumentName} is taking longer than expected to process. You can keep waiting or try asking - I'll let you know if it's not ready yet.`,
              timestamp: new Date(),
            },
          ]);
        } finally {
          setDocumentProcessing(false);
        }
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: `Document uploaded successfully: ${newDocumentName}\n\nNow ask any question. I will use this document with legal APIs, web retrieval, and LLM reasoning.`,
            timestamp: new Date(),
            documentName: newDocumentName,
          },
        ]);
      }
    } catch (error) {
      console.error("Upload error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "Document upload failed. Check Django server and the uploadDocument() endpoint in api.ts.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const sendMessage = useCallback(
  async (text?: string) => {
    const userText = (text || input).trim();

    if (!userText || loading || documentProcessing) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: userText,
      answerMode,
      documentName: documentName || undefined,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const backendMode = toBackendMode(answerMode);

      const data = await sendMessageApi({
        question: userText,
        userId: "anonymous",
        sessionId: "default-session",
        userType: answerMode === "expert" ? "lawyer" : "public",
        mode: backendMode,
        documentId,
        useAgent,
        useAdvancedAgent: !useAgent,
        chatSessionId: activeSessionId,
        region,
      });

      if (data?.chat_session_id) {
        setActiveSessionId(data.chat_session_id);
        window.history.replaceState({}, "", `/app?session=${data.chat_session_id}`);
        refreshSessions();
      }

      if (data?.needs_web_confirmation) {
        const fallbackNote = documentId
          ? "I couldn't find relevant information in your uploaded document. Would you like me to search the web for public legal sources?"
          : "I couldn't find relevant information in your firm's documents. Would you like me to search the web for public legal sources?";

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer && data.answer.trim() ? data.answer : fallbackNote,
            answerMode,
            documentName: documentName || undefined,
            timestamp: new Date(),
            awaitingWebConfirm: true,
            originalQuestion: userText,
            researchSteps: data.research_steps,
          },
        ]);
        return;
      }

      const answer = extractAnswer(data);

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answer,
        answerMode,
        documentName: documentName || undefined,
        timestamp: new Date(),
        researchSteps: data.research_steps,
        sources: data.sources as SourceItem[] | undefined,
        route: data.route,
        confidenceLevel: data.confidence_level,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "There was an error connecting to the backend. Check Django server and the sendMessage() endpoint in api.ts.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  },
  [answerMode, documentId, documentName, input, loading, documentProcessing, useAgent, activeSessionId, region, refreshSessions]
);

  const respondToWebConfirm = useCallback(
    async (messageId: string, question: string, confirmed: boolean) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? { ...message, awaitingWebConfirm: false }
            : message
        )
      );

      if (!confirmed) {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Understood — I won't search the web for this question.",
            timestamp: new Date(),
          },
        ]);
        return;
      }

      setLoading(true);

      try {
        const data = await sendMessageApi({
          question,
          userId: "anonymous",
          sessionId: "default-session",
          userType: answerMode === "expert" ? "lawyer" : "public",
          mode: toBackendMode(answerMode),
          documentId,
          allowWebSearch: true,
          useAgent,
          useAdvancedAgent: !useAgent,
          chatSessionId: activeSessionId,
          region,
        });

        if (data?.chat_session_id) {
          setActiveSessionId(data.chat_session_id);
          window.history.replaceState({}, "", `/app?session=${data.chat_session_id}`);
          refreshSessions();
        }

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: extractAnswer(data),
            answerMode,
            documentName: documentName || undefined,
            timestamp: new Date(),
            researchSteps: data.research_steps,
            sources: data.sources as SourceItem[] | undefined,
            route: data.route,
            confidenceLevel: data.confidence_level,
          },
        ]);
      } catch (error) {
        console.error("Web search error:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "Web search failed. Please try again.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [answerMode, documentId, documentName, useAgent, activeSessionId, region, refreshSessions]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setInput("");
    setActiveSessionId(null);
    setDocumentId(null);
    setDocumentName(null);
    setDocumentProcessing(false);
    window.history.replaceState({}, "", "/app");
  };

  const removeDocument = () => {
    setDocumentId(null);
    setDocumentName(null);
    setDocumentProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startRenameSession = (session: ChatSessionListItem) => {
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const commitRenameSession = async () => {
    if (editingSessionId == null) return;
    const title = editingTitle.trim();
    const sessionId = editingSessionId;
    setEditingSessionId(null);

    if (!title) return;

    try {
      await renameChatSessionApi(sessionId, title);
      refreshSessions();
    } catch (error) {
      console.error("Failed to rename chat session:", error);
    }
  };

  const handleDeleteSession = async (session: ChatSessionListItem) => {
    if (!window.confirm(`Delete "${session.title}"? This can't be undone.`)) return;

    try {
      await deleteChatSessionApi(session.id);
      if (activeSessionId === session.id) {
        clearChat();
      }
      refreshSessions();
    } catch (error) {
      console.error("Failed to delete chat session:", error);
    }
  };

  const runHistorySearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setHistoryResults(null);
      return;
    }

    setSearchingHistory(true);
    searchChatHistory(trimmed)
      .then(setHistoryResults)
      .catch((error) => {
        console.error("Chat history search failed:", error);
        setHistoryResults([]);
      })
      .finally(() => setSearchingHistory(false));
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => runHistorySearch(historyQuery), 350);
    return () => clearTimeout(handle);
  }, [historyQuery, runHistorySearch]);

  if (authLoading || !user) {
    return (
      <div
        style={{
          display: "flex",
          height: "100vh",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0906",
          color: "#8a7c68",
        }}
      >
        Loading...
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30% { transform: translateY(-6px); opacity: 1; }
        }

        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        * { box-sizing: border-box; }

        input:focus {
          outline: none;
        }

        button:focus-visible {
          outline: 2px solid rgba(201,169,110,0.45);
          outline-offset: 2px;
        }

        .msg-enter { animation: fadeUp 0.25s ease forwards; }

        .hover-card { transition: 0.2s ease; }

        .hover-card:hover {
          transform: translateY(-2px);
          border-color: rgba(201,169,110,0.35) !important;
          background: rgba(201,169,110,0.08) !important;
        }

        ::placeholder { color: #5b4f3e; }

        @media (max-width: 640px) {
          .app-header { padding: 0 12px !important; }
          .app-header-subtitle { display: none; }
          .app-header-dashboard-link { display: none; }
          .app-hero-heading { font-size: 26px !important; }
          .app-hero-sub { font-size: 13px !important; }
          .app-messages-area { padding: 16px 12px !important; }
          .app-input-area { padding: 10px 12px 14px !important; }
          .app-sidebar-open { width: 100vw !important; position: fixed; inset: 0; z-index: 30; }
        }
      `}</style>

      <div
        style={{
          display: "flex",
          height: "100vh",
          width: "100%",
          background: "#0b0906",
          color: "#f0e6cc",
          fontFamily: "Inter, Arial, sans-serif",
          overflow: "hidden",
        }}
      >
        <aside
          className={sidebarOpen ? "app-sidebar-open" : undefined}
          style={{
            width: sidebarOpen ? 260 : 0,
            transition: "width 0.3s ease",
            overflowX: "hidden",
            overflowY: "auto",
            background: "#0f0c08",
            borderRight: "1px solid rgba(201,169,110,0.1)",
            flexShrink: 0,
          }}
        >
          <div style={{ width: 260, padding: 18 }}>
            <h3 style={{ fontSize: 13, color: "#c9a96e", marginBottom: 14 }}>
              Chat Controls
            </h3>

            <button
              onClick={clearChat}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(201,169,110,0.14)",
                background: "transparent",
                color: "#8a7c68",
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              ✕ Clear chat
            </button>

            <button
              onClick={removeDocument}
              disabled={!documentId}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(201,169,110,0.14)",
                background: "transparent",
                color: documentId ? "#8a7c68" : "#3a3028",
                cursor: documentId ? "pointer" : "not-allowed",
                textAlign: "left",
              }}
            >
              🧹 Remove document
            </button>

            <label
              style={{
                marginTop: 16,
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                fontSize: 12,
                color: "#8a7c68",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={useAgent}
                onChange={(event) => setUseAgent(event.target.checked)}
                style={{ marginTop: 2 }}
              />
              <span>
                🧠 Research agent
                <br />
                <span style={{ fontSize: 10, color: "#5a4f3f" }}>
                  Breaks your question into sub-questions and researches each one
                </span>
              </span>
            </label>

            <div style={{ marginTop: 16 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 12,
                  color: "#8a7c68",
                  marginBottom: 6,
                }}
              >
                🌐 Web search region
              </label>
              <select
                value={region}
                onChange={(event) => setRegion(event.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(201,169,110,0.14)",
                  background: "#0b0906",
                  color: "#cfc0a4",
                  fontSize: 12,
                }}
              >
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 10, color: "#5a4f3f", marginTop: 4 }}>
                Restricts web search fallback to this jurisdiction's trusted sources.
              </p>
            </div>

            <div style={{ marginTop: 22, borderTop: "1px solid rgba(201,169,110,0.1)", paddingTop: 16 }}>
              <h3 style={{ fontSize: 13, color: "#c9a96e", marginBottom: 10 }}>
                Chat history
              </h3>

              <input
                value={historyQuery}
                onChange={(event) => setHistoryQuery(event.target.value)}
                placeholder="Search your chats..."
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(201,169,110,0.14)",
                  background: "#0b0906",
                  color: "#cfc0a4",
                  fontSize: 12,
                  marginBottom: 10,
                }}
              />

              {historyQuery.trim() ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    maxHeight: 320,
                    overflowY: "auto",
                    paddingRight: 2,
                  }}
                >
                  {searchingHistory && (
                    <p style={{ fontSize: 11, color: "#5a4f3f" }}>Searching...</p>
                  )}
                  {!searchingHistory && historyResults && historyResults.length === 0 && (
                    <p style={{ fontSize: 11, color: "#5a4f3f" }}>No matches.</p>
                  )}
                  {!searchingHistory &&
                    historyResults?.map((result) => (
                      <button
                        key={result.id}
                        onClick={() => {
                          if (result.chat_session_id) {
                            loadSession(result.chat_session_id);
                            setHistoryQuery("");
                            setHistoryResults(null);
                          }
                        }}
                        disabled={!result.chat_session_id}
                        title={!result.chat_session_id ? "This chat is too old to resume" : undefined}
                        style={{
                          textAlign: "left",
                          padding: "8px 10px",
                          borderRadius: 8,
                          border: "1px solid rgba(201,169,110,0.1)",
                          background: "rgba(201,169,110,0.03)",
                          color: result.chat_session_id ? "#cfc0a4" : "#5a4f3f",
                          fontSize: 11,
                          cursor: result.chat_session_id ? "pointer" : "not-allowed",
                        }}
                      >
                        {result.question}
                      </button>
                    ))}
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    maxHeight: 320,
                    overflowY: "auto",
                    paddingRight: 2,
                  }}
                >
                  {chatSessions.length === 0 && (
                    <p style={{ fontSize: 11, color: "#5a4f3f" }}>No chats yet.</p>
                  )}
                  {chatSessions.map((session) => (
                    <div
                      key={session.id}
                      className="hover-card"
                      style={{
                        borderRadius: 10,
                        border:
                          activeSessionId === session.id
                            ? "1px solid rgba(201,169,110,0.4)"
                            : "1px solid rgba(201,169,110,0.08)",
                        background:
                          activeSessionId === session.id
                            ? "rgba(201,169,110,0.1)"
                            : "transparent",
                        padding: "8px 9px",
                      }}
                    >
                      {editingSessionId === session.id ? (
                        <input
                          autoFocus
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") commitRenameSession();
                            if (event.key === "Escape") setEditingSessionId(null);
                          }}
                          onBlur={commitRenameSession}
                          style={{
                            width: "100%",
                            padding: "4px 6px",
                            borderRadius: 6,
                            border: "1px solid rgba(201,169,110,0.3)",
                            background: "#0b0906",
                            color: "#f0e6cc",
                            fontSize: 12,
                          }}
                        />
                      ) : (
                        <>
                          <button
                            onClick={() => loadSession(session.id)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              border: "none",
                              background: "transparent",
                              color: activeSessionId === session.id ? "#f0e6cc" : "#cfc0a4",
                              fontSize: 12,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {session.title}
                          </button>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                            <span style={{ fontSize: 9, color: "#5a4f3f" }}>
                              {session.message_count} msg{session.message_count === 1 ? "" : "s"}
                            </span>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                onClick={() => startRenameSession(session)}
                                title="Rename"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#8a7c68",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  padding: 2,
                                }}
                              >
                                ✏️
                              </button>
                              <button
                                onClick={() => handleDeleteSession(session)}
                                title="Delete"
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#8a7c68",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  padding: 2,
                                }}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ marginTop: 18, borderTop: "1px solid rgba(201,169,110,0.1)", paddingTop: 14 }}>
              {user && (
                <p style={{ margin: "0 0 8px", fontSize: 11, color: "#5a4f3f" }}>
                  {user.full_name} · {user.role}
                </p>
              )}
              <button
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(201,169,110,0.15)",
                  background: "transparent",
                  color: "#8a7c68",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 12,
                }}
              >
                Log out
              </button>
            </div>
          </div>
        </aside>

        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <header
            className="app-header"
            style={{
              minHeight: 66,
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "1px solid rgba(201,169,110,0.1)",
              background: "rgba(11,9,6,0.94)",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={() => setSidebarOpen((prev) => !prev)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid rgba(201,169,110,0.15)",
                  background: "transparent",
                  color: "#c9a96e",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                {sidebarOpen ? "✕" : "☰"}
              </button>

              <div>
                <h1 style={{ margin: 0, fontSize: 18 }}>⚖️ Legal AI</h1>
                <p className="app-header-subtitle" style={{ margin: "3px 0 0", color: "#5a4f3f", fontSize: 11 }}>
                  Public + Professional Legal AI
                </p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {user.role !== "public" && (
                <Link
                  href="/dashboard"
                  className="app-header-dashboard-link"
                  style={{
                    padding: "5px 10px",
                    borderRadius: 999,
                    background: "transparent",
                    border: "1px solid rgba(201,169,110,0.14)",
                    color: "#8a7c68",
                    fontSize: 11,
                    textDecoration: "none",
                  }}
                >
                  ← Dashboard
                </Link>
              )}

              <span
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  background: "rgba(201,169,110,0.08)",
                  border: "1px solid rgba(201,169,110,0.14)",
                  color: "#c9a96e",
                  fontSize: 11,
                }}
              >
                {getModeLabel(answerMode)}
              </span>
            </div>
          </header>

          <div className="app-messages-area" style={{ flex: 1, overflowY: "auto", padding: "28px 20px" }}>
            {resumingSession ? (
              <div style={{ textAlign: "center", paddingTop: 60, color: "#8a7c68", fontSize: 13 }}>
                Loading conversation...
              </div>
            ) : messages.length === 0 ? (
              <div style={{ maxWidth: 820, margin: "0 auto", paddingTop: 18 }}>
                <div style={{ textAlign: "center", marginBottom: 30 }}>
                  <div
                    style={{
                      width: 70,
                      height: 70,
                      margin: "0 auto 18px",
                      borderRadius: 20,
                      background:
                        "linear-gradient(135deg, rgba(201,169,110,0.18), rgba(201,169,110,0.28))",
                      border: "1px solid rgba(201,169,110,0.25)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 30,
                    }}
                  >
                    ⚖️
                  </div>

                  <h2 className="app-hero-heading" style={{ margin: 0, fontSize: 42 }}>
                    Legal help that adapts to you.
                  </h2>

                  <p
                    className="app-hero-sub"
                    style={{
                      maxWidth: 560,
                      margin: "12px auto 0",
                      color: "#8a7c68",
                      lineHeight: 1.7,
                      fontSize: 14,
                    }}
                  >
                    Select answer mode and ask your legal question directly,
                    or upload a document first to ask about it specifically.
                  </p>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                    gap: 10,
                  }}
                >
                  {SUGGESTED_QUESTIONS.map((item) => (
                    <button
                      key={item.text}
                      className="hover-card"
                      onClick={() => sendMessage(item.text)}
                      style={{
                        textAlign: "left",
                        padding: 15,
                        borderRadius: 14,
                        border: "1px solid rgba(201,169,110,0.12)",
                        background: "rgba(201,169,110,0.04)",
                        color: "#cfc0a4",
                        cursor: "pointer",
                        display: "flex",
                        gap: 10,
                      }}
                    >
                      <span>{item.icon}</span>
                      <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                        {item.text}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div
                style={{
                  maxWidth: 820,
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                }}
              >
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className="msg-enter"
                    style={{
                      display: "flex",
                      justifyContent:
                        message.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "82%",
                        padding: "14px 17px",
                        borderRadius:
                          message.role === "user"
                            ? "16px 5px 16px 16px"
                            : "5px 16px 16px 16px",
                        background:
                          message.role === "user"
                            ? "linear-gradient(135deg, #162750, #0d1a3a)"
                            : "rgba(20,16,10,0.96)",
                        border:
                          message.role === "user"
                            ? "1px solid rgba(80,130,220,0.2)"
                            : "1px solid rgba(201,169,110,0.12)",
                      }}
                    >
                      {message.role === "assistant" ? (
                        <>
                          <FormattedMessage content={message.content} />
                          {message.awaitingWebConfirm && (
                            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                              <button
                                onClick={() =>
                                  respondToWebConfirm(
                                    message.id,
                                    message.originalQuestion || "",
                                    true
                                  )
                                }
                                style={{
                                  padding: "7px 14px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(201,169,110,0.4)",
                                  background: "#c9a96e",
                                  color: "#1a0e00",
                                  fontWeight: 700,
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                Yes, search the web
                              </button>
                              <button
                                onClick={() =>
                                  respondToWebConfirm(
                                    message.id,
                                    message.originalQuestion || "",
                                    false
                                  )
                                }
                                style={{
                                  padding: "7px 14px",
                                  borderRadius: 999,
                                  border: "1px solid rgba(201,169,110,0.2)",
                                  background: "transparent",
                                  color: "#8a7c68",
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                              >
                                No
                              </button>
                            </div>
                          )}
                          {message.researchSteps && message.researchSteps.length > 0 && (
                            <details style={{ marginTop: 10 }}>
                              <summary
                                style={{ fontSize: 11, color: "#8a7c68", cursor: "pointer" }}
                              >
                                🧠 Research steps ({message.researchSteps.length})
                              </summary>
                              <ul style={{ marginTop: 6, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 4 }}>
                                {message.researchSteps.map((step, index) => (
                                  <li key={index} style={{ fontSize: 11, color: "#5a4f3f" }}>
                                    {step.source_type === "document" && "📄 "}
                                    {step.source_type === "web" && "🌐 "}
                                    {step.source_type === "pending_web" && "⏳ "}
                                    {step.source_type === "unresolved" && "❌ "}
                                    {step.source_type === "case" && "🗂️ "}
                                    {step.source_type === "draft" && "📝 "}
                                    {step.source_type === "compare" && "🔍 "}
                                    {step.source_type === "context" && "🧭 "}
                                    {step.sub_question}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                          {message.sources && message.sources.length > 0 && (() => {
                            const bestByDocument = new Map<string, SourceItem>();
                            for (const s of message.sources!) {
                              if (s.source_type !== "document" || !s.document_name) continue;
                              const existing = bestByDocument.get(s.document_name);
                              const better =
                                !existing ||
                                (s.confidence_percent ?? -1) > (existing.confidence_percent ?? -1);
                              if (better) bestByDocument.set(s.document_name, s);
                            }
                            const docEntries = Array.from(bestByDocument.values());
                            const webSources = message.sources!.filter(
                              (s) => s.source_type === "web" && s.url
                            );

                            if (docEntries.length === 0 && webSources.length === 0) return null;

                            return (
                              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {docEntries.map((s) => (
                                  <span
                                    key={s.document_name}
                                    title={
                                      s.confidence_percent != null
                                        ? `Confidence: ${s.confidence_percent}%`
                                        : undefined
                                    }
                                    style={{
                                      fontSize: 10,
                                      padding: "3px 8px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(201,169,110,0.2)",
                                      color: "#c9a96e",
                                      background: "rgba(201,169,110,0.06)",
                                    }}
                                  >
                                    📄 {s.document_name}
                                    {s.page_number ? ` · p.${s.page_number}` : ""}
                                    {s.confidence_percent != null ? ` · ${s.confidence_percent}%` : ""}
                                  </span>
                                ))}
                                {webSources.map((s, index) => (
                                  <a
                                    key={index}
                                    href={s.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                      fontSize: 10,
                                      padding: "3px 8px",
                                      borderRadius: 999,
                                      border: "1px solid rgba(120,170,220,0.2)",
                                      color: "#8fb4e3",
                                      background: "rgba(120,170,220,0.06)",
                                      textDecoration: "none",
                                    }}
                                  >
                                    🌐 {s.source_site || s.title || "Web source"}
                                  </a>
                                ))}
                              </div>
                            );
                          })()}
                          {message.route && (
                            <div
                              style={{
                                marginTop: 10,
                                paddingTop: 8,
                                borderTop: "1px solid rgba(201,169,110,0.08)",
                                fontSize: 10,
                                color: "#5a4f3f",
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 4,
                              }}
                            >
                              <span style={{ color: "#8a7c68" }}>Source Summary —</span>
                              <span>Route: {ROUTE_LABELS[message.route] || message.route}</span>
                              {message.confidenceLevel && (
                                <span>· Confidence: {message.confidenceLevel}</span>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <p
                          style={{
                            margin: 0,
                            color: "#b8ccec",
                            fontSize: 13.5,
                            lineHeight: 1.7,
                          }}
                        >
                          {message.content}
                        </p>
                      )}

                      <div
                        style={{
                          marginTop: 9,
                          display: "flex",
                          gap: 8,
                          flexWrap: "wrap",
                          fontSize: 10,
                          color: "#5a4f3f",
                        }}
                      >
                        {message.answerMode && (
                          <span>Mode: {getModeLabel(message.answerMode)}</span>
                        )}
                        {message.documentName && (
                          <span>Doc: {message.documentName}</span>
                        )}
                        <span>
                          {message.timestamp.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {loading && (
                  <div style={{ display: "flex", justifyContent: "flex-start" }}>
                    <div
                      style={{
                        padding: "14px 17px",
                        borderRadius: "5px 16px 16px 16px",
                        background: "rgba(20,16,10,0.96)",
                        border: "1px solid rgba(201,169,110,0.12)",
                      }}
                    >
                      <TypingDots />
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <div
            className="app-input-area"
            style={{
              padding: "14px 20px 18px",
              borderTop: "1px solid rgba(201,169,110,0.1)",
              background: "rgba(11,9,6,0.96)",
            }}
          >
            <div style={{ maxWidth: 820, margin: "0 auto" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                  gap: 9,
                  marginBottom: 10,
                }}
              >
                {ANSWER_MODES.map((mode) => {
                  const active = answerMode === mode.value;

                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setAnswerMode(mode.value)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 13,
                        border: active
                          ? "1px solid rgba(201,169,110,0.55)"
                          : "1px solid rgba(201,169,110,0.12)",
                        background: active
                          ? "rgba(201,169,110,0.13)"
                          : "rgba(255,255,255,0.025)",
                        color: active ? "#f0e6cc" : "#8a7c68",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span>{mode.icon}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 800 }}>
                            {mode.label}
                          </div>
                          <div style={{ fontSize: 10, color: "#5a4f3f" }}>
                            {mode.desc}
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {documentName && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: "9px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(201,169,110,0.16)",
                    background: "rgba(201,169,110,0.05)",
                    color: "#c9a96e",
                    fontSize: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                  }}
                >
                  <span>
                    📄 Active document: {documentName}
                    {documentProcessing && (
                      <span style={{ color: "#8a7c68", marginLeft: 8 }}>
                        ⏳ Processing...
                      </span>
                    )}
                  </span>
                  <button
                    onClick={removeDocument}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "#c9a96e",
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  border: `1px solid rgba(201,169,110,${input ? "0.32" : "0.12"})`,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.035)",
                  padding: "8px 10px",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.22)",
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.md,.png,.jpg,.jpeg"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadDocument(file);
                  }}
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "1px solid rgba(201,169,110,0.14)",
                    background: "rgba(201,169,110,0.06)",
                    color: uploading ? "#5a4f3f" : "#c9a96e",
                    cursor: uploading ? "not-allowed" : "pointer",
                    flexShrink: 0,
                  }}
                  title="Upload document"
                >
                  {uploading ? "⏳" : "📎"}
                </button>

                <input
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask legal question in any language..."
                  style={{
                    flex: 1,
                    height: 38,
                    background: "transparent",
                    border: "none",
                    color: "#e0d2ba",
                    fontSize: 14,
                    minWidth: 0,
                  }}
                />
       
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || loading || documentProcessing}
                  title={documentProcessing ? "Document is still processing..." : undefined}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    border: "none",
                    background:
                      input.trim() && !loading && !documentProcessing
                        ? "#c9a96e"
                        : "rgba(201,169,110,0.12)",
                    color: input.trim() && !loading && !documentProcessing ? "#1a0e00" : "#3a3028",
                    cursor: input.trim() && !loading && !documentProcessing ? "pointer" : "not-allowed",
                    flexShrink: 0,
                    fontWeight: 900,
                  }}
                >
                  {loading ? "⏳" : "→"}
                </button>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                  color: "#3a3028",
                  fontSize: 10,
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span>Current: {getModeLabel(answerMode)}</span>
                <span>Enter to send</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
