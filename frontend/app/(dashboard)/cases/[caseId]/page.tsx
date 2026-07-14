"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  completeReminder,
  createReminder,
  deleteCase,
  getCase,
  listCaseActivities,
  postCaseComment,
  sendMessage,
  updateCase,
  uploadDocument,
  type CaseActivity,
  type CaseDetail,
  type Reminder,
  type ResearchStep,
} from "@/lib/api";

type SourceItem = {
  source_type?: string;
  document_id?: string;
  document_name?: string;
  page_number?: number | null;
  confidence_percent?: number | null;
  source_site?: string;
  title?: string;
  url?: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
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

const STATUSES = ["open", "in_progress", "on_hold", "closed"];

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const router = useRouter();
  const caseId = params.caseId;

  const { user } = useAuth();
  const canEditCase = hasPermission(user?.role, "edit_case");
  const canDeleteCase = hasPermission(user?.role, "delete_case");

  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [driveLink, setDriveLink] = useState("");
  const [savingDriveLink, setSavingDriveLink] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDue, setReminderDue] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [useAgent, setUseAgent] = useState(false);

  const [activities, setActivities] = useState<CaseActivity[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadCase = useCallback(() => {
    setLoading(true);
    getCase(caseId)
      .then((data) => {
        setCaseDetail(data);
        setDriveLink(data.drive_link || "");
      })
      .finally(() => setLoading(false));
  }, [caseId]);

  const loadActivities = useCallback(() => {
    listCaseActivities(caseId).then(setActivities);
  }, [caseId]);

  useEffect(() => {
    loadCase();
    loadActivities();
  }, [loadCase, loadActivities]);

  const handleStatusChange = async (status: string) => {
    const updated = await updateCase(caseId, { status });
    setCaseDetail(updated);
    loadActivities();
  };

  const handleSaveDriveLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingDriveLink(true);

    try {
      const updated = await updateCase(caseId, { drive_link: driveLink.trim() });
      setCaseDetail(updated);
    } finally {
      setSavingDriveLink(false);
    }
  };

  const handleDeleteCase = async () => {
    if (!confirm("Delete this case? This cannot be undone.")) return;

    setDeleting(true);

    try {
      await deleteCase(caseId);
      router.push("/cases");
    } finally {
      setDeleting(false);
    }
  };

  const handlePostComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!commentBody.trim()) return;

    setPostingComment(true);

    try {
      await postCaseComment(caseId, commentBody.trim());
      setCommentBody("");
      loadActivities();
    } finally {
      setPostingComment(false);
    }
  };

  const handleAddReminder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!reminderTitle || !reminderDue) return;

    setAddingReminder(true);

    try {
      await createReminder({
        case_id: caseId,
        title: reminderTitle,
        due_date: new Date(reminderDue).toISOString(),
      });
      setReminderTitle("");
      setReminderDue("");
      loadCase();
      loadActivities();
    } finally {
      setAddingReminder(false);
    }
  };

  const handleCompleteReminder = async (reminderId: number) => {
    await completeReminder(reminderId);
    loadCase();
    loadActivities();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);

    try {
      const data = await uploadDocument(file, "anonymous", caseId);
      const newDocumentId =
        data.document_id || data.documentId || data.id || null;
      const newDocumentName = data.file_name || data.filename || file.name;

      setDocumentId(newDocumentId);
      setDocumentName(newDocumentName);

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `Document uploaded: ${newDocumentName}. Ask a question about it below.`,
        },
      ]);
      loadActivities();
    } catch (error: any) {
      console.error("Upload error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error?.response?.data?.error || "Document upload failed. Please try again.",
        },
      ]);
    } finally {
      setUploading(false);
    }
  };

  const handleAsk = async () => {
    const text = question.trim();
    if (!text || asking) return;

    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text }]);
    setQuestion("");
    setAsking(true);

    try {
      const data = await sendMessage({
        question: text,
        documentId,
        caseId: caseId ? Number(caseId) : null,
        useAgent,
        useAdvancedAgent: !useAgent,
      });

      if (data?.needs_web_confirmation) {
        const fallbackNote = documentId
          ? "No relevant information found in this document. Search the web for public legal sources?"
          : "No relevant information found in your firm's documents. Search the web for public legal sources?";

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: data.answer && data.answer.trim() ? data.answer : fallbackNote,
            awaitingWebConfirm: true,
            originalQuestion: text,
            researchSteps: data.research_steps,
          },
        ]);
        return;
      }

      const answer = data?.answer || "No answer returned.";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: answer,
          researchSteps: data.research_steps,
          sources: data.sources as SourceItem[] | undefined,
          route: data.route,
          confidenceLevel: data.confidence_level,
        },
      ]);
    } catch (error: any) {
      console.error("Ask question error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error?.response?.data?.error || "Something went wrong answering that question. Please try again.",
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  const handleWebConfirm = async (
    messageId: string,
    originalQuestion: string,
    confirmed: boolean
  ) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, awaitingWebConfirm: false } : message
      )
    );

    if (!confirmed) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "Understood — I won't search the web for this question.",
        },
      ]);
      return;
    }

    setAsking(true);

    try {
      const data = await sendMessage({
        question: originalQuestion,
        documentId,
        caseId: caseId ? Number(caseId) : null,
        allowWebSearch: true,
        useAgent,
        useAdvancedAgent: !useAgent,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data?.answer || "No answer returned.",
          researchSteps: data.research_steps,
          sources: data.sources as SourceItem[] | undefined,
          route: data.route,
          confidenceLevel: data.confidence_level,
        },
      ]);
    } catch (error: any) {
      console.error("Web search error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: error?.response?.data?.error || "Web search failed. Please try again.",
        },
      ]);
    } finally {
      setAsking(false);
    }
  };

  if (loading || !caseDetail) {
    return <p className="text-[#8a7c68]">Loading case...</p>;
  }

  const openReminders = caseDetail.reminders.filter((r) => !r.is_completed);
  const completedReminders = caseDetail.reminders.filter((r) => r.is_completed);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-[#f0e6cc] wrap-break-word">{caseDetail.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={caseDetail.status}
              onChange={(event) => handleStatusChange(event.target.value)}
              disabled={!canEditCase}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-1 text-sm text-[#e0d2ba] disabled:opacity-50"
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            {canDeleteCase && (
              <button
                onClick={handleDeleteCase}
                disabled={deleting}
                className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete case"}
              </button>
            )}
          </div>
        </div>
        <p className="text-sm text-[#8a7c68]">
          {caseDetail.case_type} · {caseDetail.client_name || "No client name"} ·{" "}
          {caseDetail.assigned_lawyer_names.join(", ")}
        </p>

        {canEditCase ? (
          <form onSubmit={handleSaveDriveLink} className="mt-2 flex gap-2">
            <input
              value={driveLink}
              onChange={(event) => setDriveLink(event.target.value)}
              placeholder="Drive / Dropbox folder link (optional)"
              className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-1.5 text-xs text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
            <button
              type="submit"
              disabled={savingDriveLink}
              className="rounded-lg border border-[#c9a96e]/15 px-3 py-1.5 text-xs text-[#c9a96e] disabled:opacity-50"
            >
              {savingDriveLink ? "Saving..." : "Save link"}
            </button>
          </form>
        ) : (
          caseDetail.drive_link && (
            <a
              href={caseDetail.drive_link}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs text-[#c9a96e] hover:underline"
            >
              📁 Open linked folder
            </a>
          )
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Reminders</h2>

          <form onSubmit={handleAddReminder} className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={reminderTitle}
              onChange={(event) => setReminderTitle(event.target.value)}
              placeholder="Reminder title"
              required
              className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
            <input
              type="datetime-local"
              value={reminderDue}
              onChange={(event) => setReminderDue(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            />
            <button
              type="submit"
              disabled={addingReminder}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
            >
              Add
            </button>
          </form>

          <div className="flex flex-col gap-2">
            {openReminders.length === 0 && (
              <p className="text-sm text-[#5a4f3f]">No open reminders.</p>
            )}
            {openReminders.map((reminder: Reminder) => (
              <div
                key={reminder.id}
                className="flex items-center justify-between rounded-lg border border-[#c9a96e]/10 px-3 py-2 text-sm"
              >
                <div>
                  <p className="text-[#e0d2ba]">{reminder.title}</p>
                  <p className="text-xs text-[#8a7c68]">due {formatDate(reminder.due_date)}</p>
                </div>
                <button
                  onClick={() => handleCompleteReminder(reminder.id)}
                  className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                >
                  Mark done
                </button>
              </div>
            ))}

            {completedReminders.length > 0 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-[#5a4f3f]">
                  {completedReminders.length} completed
                </summary>
                <div className="mt-2 flex flex-col gap-1">
                  {completedReminders.map((reminder) => (
                    <p key={reminder.id} className="text-xs text-[#5a4f3f] line-through">
                      {reminder.title}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Documents &amp; chat</h2>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.pptx,.jpg,.jpeg,.png"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleUpload(file);
            }}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="mb-3 rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "📎 Upload document"}
          </button>

          {documentName && (
            <p className="mb-3 text-xs text-[#8a7c68]">Active document: {documentName}</p>
          )}

          <label className="mb-3 flex items-center gap-2 text-xs text-[#8a7c68]">
            <input
              type="checkbox"
              checked={useAgent}
              onChange={(event) => setUseAgent(event.target.checked)}
            />
            🧠 Research agent (breaks question into sub-questions)
          </label>

          <div className="mb-3 flex max-h-64 flex-col gap-2 overflow-y-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "self-end bg-[#162750] text-[#b8ccec]"
                    : "bg-[#14100a] text-[#cfc0a4]"
                }`}
              >
                {message.content}
                {message.awaitingWebConfirm && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() =>
                        handleWebConfirm(message.id, message.originalQuestion || "", true)
                      }
                      className="rounded-full bg-[#c9a96e] px-3 py-1 text-xs font-semibold text-[#1a0e00]"
                    >
                      Yes, search the web
                    </button>
                    <button
                      onClick={() =>
                        handleWebConfirm(message.id, message.originalQuestion || "", false)
                      }
                      className="rounded-full border border-[#c9a96e]/20 px-3 py-1 text-xs text-[#8a7c68]"
                    >
                      No
                    </button>
                  </div>
                )}
                {message.researchSteps && message.researchSteps.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-[#8a7c68]">
                      🧠 Research steps ({message.researchSteps.length})
                    </summary>
                    <ul className="mt-1 flex flex-col gap-1 pl-4">
                      {message.researchSteps.map((step, index) => (
                        <li key={index} className="text-[11px] text-[#5a4f3f]">
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
                      !existing || (s.confidence_percent ?? -1) > (existing.confidence_percent ?? -1);
                    if (better) bestByDocument.set(s.document_name, s);
                  }
                  const docEntries = Array.from(bestByDocument.values());
                  const webSources = message.sources!.filter((s) => s.source_type === "web" && s.url);

                  if (docEntries.length === 0 && webSources.length === 0) return null;

                  return (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {docEntries.map((s) => (
                        <span
                          key={s.document_name}
                          title={
                            s.confidence_percent != null ? `Confidence: ${s.confidence_percent}%` : undefined
                          }
                          className="rounded-full border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-2 py-0.5 text-[10px] text-[#c9a96e]"
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
                          className="rounded-full border border-blue-400/20 bg-blue-400/5 px-2 py-0.5 text-[10px] text-blue-300 no-underline"
                        >
                          🌐 {s.source_site || s.title || "Web source"}
                        </a>
                      ))}
                    </div>
                  );
                })()}
                {message.route && (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-[#c9a96e]/10 pt-1.5 text-[10px] text-[#5a4f3f]">
                    <span className="text-[#8a7c68]">Source Summary —</span>
                    <span>Route: {ROUTE_LABELS[message.route] || message.route}</span>
                    {message.confidenceLevel && <span>· Confidence: {message.confidenceLevel}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAsk();
                }
              }}
              placeholder={documentId ? "Ask a question about this document..." : "Ask a question about this case..."}
              className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50 disabled:opacity-50"
            />
            <button
              onClick={handleAsk}
              disabled={asking || !question.trim()}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
            >
              {asking ? "..." : "Ask"}
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">Activity</h2>

        <form onSubmit={handlePostComment} className="mb-4 flex gap-2">
          <input
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Post a comment for anyone assigned to this case..."
            className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
          <button
            type="submit"
            disabled={postingComment || !commentBody.trim()}
            className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
          >
            {postingComment ? "Posting..." : "Post"}
          </button>
        </form>

        {activities.length === 0 ? (
          <p className="text-sm text-[#5a4f3f]">No activity yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activities.map((activity) =>
              activity.activity_type === "comment" ? (
                <li
                  key={activity.id}
                  className="rounded-lg bg-[#162750] px-3 py-2 text-sm text-[#b8ccec]"
                >
                  <p className="mb-1 text-xs font-semibold text-[#c9d9f2]">
                    {activity.actor_name || "Unknown"}
                  </p>
                  <p>{activity.body}</p>
                  <p className="mt-1 text-[10px] text-[#5a6f8f]">
                    {formatDate(activity.created_at)}
                  </p>
                </li>
              ) : (
                <li key={activity.id} className="px-1 text-xs text-[#8a7c68]">
                  {formatDate(activity.created_at)} — {activity.body}
                </li>
              )
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
