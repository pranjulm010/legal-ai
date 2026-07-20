"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  completeReminder,
  createReminder,
  deleteCase,
  deleteDocument,
  getCase,
  listCaseActivities,
  postCaseComment,
  updateCase,
  uploadDocument,
  type CaseActivity,
  type CaseDetail,
  type Reminder,
} from "@/lib/api";

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

  const { user, permissions } = useAuth();
  const canEditCase = hasPermission(user?.role, "edit_case", permissions);
  const canDeleteCase = hasPermission(user?.role, "delete_case", permissions);
  const canDeleteDocument = hasPermission(user?.role, "delete_document", permissions);

  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const [driveLink, setDriveLink] = useState("");
  const [savingDriveLink, setSavingDriveLink] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderDue, setReminderDue] = useState("");
  const [addingReminder, setAddingReminder] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);

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
      await uploadDocument(file, "anonymous", caseId);
      // Reload the case so the newly-linked document appears in the
      // persistent Documents list below (it survives a page refresh
      // because it's read from caseDetail.documents, not upload state).
      loadCase();
      loadActivities();
    } catch (error: any) {
      console.error("Upload error:", error);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteDocument = async (documentId: string, fileName: string) => {
    if (!confirm(`Remove "${fileName}" from this case? This deletes the document and cannot be undone.`)) {
      return;
    }

    setDeletingDocumentId(documentId);

    try {
      await deleteDocument(documentId);
      loadCase();
      loadActivities();
    } catch (error) {
      console.error("Delete document error:", error);
      alert("Couldn't delete that document. Please try again.");
    } finally {
      setDeletingDocumentId(null);
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
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Documents</h2>

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
            className="rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "📎 Upload document"}
          </button>

          {caseDetail.documents.length === 0 ? (
            <p className="mt-3 text-xs text-[#5a4f3f]">
              No documents linked to this case yet.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {caseDetail.documents.map((doc) => (
                <li
                  key={doc.document_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#c9a96e]/12 bg-[#c9a96e]/5 px-3 py-2 text-xs text-[#cfc0a4]"
                >
                  <span className="min-w-0 break-words">📄 {doc.file_name}</span>
                  {canDeleteDocument && (
                    <button
                      onClick={() => handleDeleteDocument(doc.document_id, doc.file_name)}
                      disabled={deletingDocumentId === doc.document_id}
                      className="shrink-0 rounded-md border border-red-400/25 px-2 py-1 text-[11px] text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      {deletingDocumentId === doc.document_id ? "Deleting..." : "Delete"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
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
