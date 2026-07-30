"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  compareDocuments,
  deleteDocument,
  getDocumentContent,
  listDocuments,
  renameDocument,
  reprocessDocument,
  updateDocumentContent,
  waitForDocumentReady,
  type DocumentListItem,
} from "@/lib/api";

const PAGE_SIZE = 10;

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const RAG_STATUS_STYLES: Record<string, string> = {
  ready: "bg-emerald-500/10 text-emerald-300",
  processing: "bg-amber-500/10 text-amber-300",
  failed: "bg-red-500/10 text-red-300",
};

const RAG_STATUS_LABELS: Record<string, string> = {
  ready: "RAG: Ready",
  processing: "RAG: Processing...",
  failed: "RAG: Failed",
};

function RagStatusBadge({ doc }: { doc: DocumentListItem }) {
  const status = doc.status || "ready";
  return (
    <span
      title={status === "failed" ? doc.error_message || "Processing failed." : undefined}
      className={`rounded-full px-2 py-0.5 text-[10px] font-normal ${
        RAG_STATUS_STYLES[status] || "bg-[#8a7c68]/10 text-[#8a7c68]"
      }`}
    >
      {RAG_STATUS_LABELS[status] || status}
    </span>
  );
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const canDeleteDocument = hasPermission(user?.role, "delete_document");
  const canEditDocument = hasPermission(user?.role, "edit_document");

  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editingRenameId, setEditingRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  const [editingDoc, setEditingDoc] = useState<DocumentListItem | null>(null);
  const [contentDraft, setContentDraft] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);

  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<string | null>(null);

  const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set());
  const pollingIds = useRef<Set<string>>(new Set());

  const updateDocumentInList = (documentId: string, patch: Partial<DocumentListItem>) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.document_id === documentId ? { ...doc, ...patch } : doc))
    );
  };

  // Watches a document that's mid-embed (just uploaded, edited, or force
  // re-run) and updates its badge in place once the background pipeline
  // finishes, instead of requiring a manual page refresh to find out.
  const pollDocumentStatus = (documentId: string) => {
    if (pollingIds.current.has(documentId)) return;
    pollingIds.current.add(documentId);
    waitForDocumentReady(documentId)
      .then((result) => {
        updateDocumentInList(documentId, {
          status: result.status,
          error_message: result.error_message,
        });
      })
      .catch(() => {
        // Still processing after the polling budget - leave the badge as
        // "processing"; the next full list load will pick up the truth.
      })
      .finally(() => {
        pollingIds.current.delete(documentId);
      });
  };

  const load = (tag?: string) => {
    setLoading(true);
    setPage(1);
    listDocuments(tag ? { tag } : undefined)
      .then((docs) => {
        setDocuments(docs);
        docs.filter((doc) => doc.status === "processing").forEach((doc) => pollDocumentStatus(doc.document_id));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleForceRerun = async (doc: DocumentListItem) => {
    setRerunningIds((prev) => new Set(prev).add(doc.document_id));
    try {
      const result = await reprocessDocument(doc.document_id);
      updateDocumentInList(doc.document_id, {
        status: result.status,
        error_message: result.error_message,
      });
      pollDocumentStatus(doc.document_id);
    } catch {
      alert("Could not start re-processing. Please try again.");
    } finally {
      setRerunningIds((prev) => {
        const next = new Set(prev);
        next.delete(doc.document_id);
        return next;
      });
    }
  };

  const handleFilter = (event: React.FormEvent) => {
    event.preventDefault();
    load(tagFilter || undefined);
  };

  const startRename = (doc: DocumentListItem) => {
    setEditingRenameId(doc.document_id);
    setRenameDraft(doc.file_name);
  };

  const handleSaveRename = async (documentId: string) => {
    const name = renameDraft.trim();
    if (!name) return;
    setSavingRename(true);
    try {
      const updated = await renameDocument(documentId, name);
      setDocuments((prev) =>
        prev.map((doc) => (doc.document_id === documentId ? updated : doc))
      );
      setEditingRenameId(null);
    } finally {
      setSavingRename(false);
    }
  };

  const openEditor = async (doc: DocumentListItem) => {
    setEditingDoc(doc);
    setContentDraft("");
    setContentError(null);
    setLoadingContent(true);
    try {
      const { content } = await getDocumentContent(doc.document_id);
      setContentDraft(content);
    } catch {
      setContentError("Could not load this document's text for editing.");
    } finally {
      setLoadingContent(false);
    }
  };

  const closeEditor = () => {
    setEditingDoc(null);
    setContentDraft("");
    setContentError(null);
  };

  const handleSaveContent = async () => {
    if (!editingDoc) return;
    const content = contentDraft.trim();
    if (!content) {
      setContentError("Document content cannot be empty.");
      return;
    }
    setSavingContent(true);
    setContentError(null);
    try {
      await updateDocumentContent(editingDoc.document_id, content);
      closeEditor();
      load(tagFilter || undefined);
    } catch {
      setContentError("Saving failed. Please try again.");
    } finally {
      setSavingContent(false);
    }
  };

  const handleDelete = async (doc: DocumentListItem) => {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return;
    await deleteDocument(doc.document_id);
    setCompareSelection((prev) => prev.filter((id) => id !== doc.document_id));
    load();
  };

  const toggleCompareSelection = (documentId: string) => {
    setCompareResult(null);
    setCompareSelection((prev) => {
      if (prev.includes(documentId)) return prev.filter((id) => id !== documentId);
      if (prev.length >= 2) return [prev[1], documentId];
      return [...prev, documentId];
    });
  };

  const handleCompare = async () => {
    if (compareSelection.length !== 2) return;
    setComparing(true);
    setCompareResult(null);

    try {
      const result = await compareDocuments(compareSelection[0], compareSelection[1]);
      setCompareResult(result);
    } finally {
      setComparing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedDocuments = documents.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Documents</h1>
        <p className="text-sm text-[#8a7c68]">
          Every document uploaded across your firm - filter by tag or compare any two.
        </p>
      </div>

      <form onSubmit={handleFilter} className="flex gap-2">
        <input
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
          placeholder="Filter by tag..."
          className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
        >
          Filter
        </button>
      </form>

      {compareSelection.length === 2 && (
        <button
          onClick={handleCompare}
          disabled={comparing}
          className="self-start rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {comparing ? "Comparing..." : "Compare selected documents"}
        </button>
      )}

      {compareResult && (
        <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 text-sm whitespace-pre-wrap text-[#cfc0a4]">
          {compareResult}
        </div>
      )}

      {loading ? (
        <p className="text-[#8a7c68]">Loading documents...</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-[#5a4f3f]">No documents found.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pagedDocuments.map((doc) => (
            <li
              key={doc.document_id}
              className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={compareSelection.includes(doc.document_id)}
                    onChange={() => toggleCompareSelection(doc.document_id)}
                    className="mt-1"
                  />
                  <div>
                    {editingRenameId === doc.document_id ? (
                      <div
                        className="flex items-center gap-2"
                        onClick={(event) => event.preventDefault()}
                      >
                        <input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === "Enter") handleSaveRename(doc.document_id);
                            if (event.key === "Escape") setEditingRenameId(null);
                          }}
                          className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-2 py-1 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                        />
                        <button
                          onClick={() => handleSaveRename(doc.document_id)}
                          disabled={savingRename || !renameDraft.trim()}
                          className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#c9a96e] disabled:opacity-50"
                        >
                          {savingRename ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={() => setEditingRenameId(null)}
                          className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="flex flex-wrap items-center gap-2 font-medium text-[#e0d2ba]">
                        {doc.file_name}
                        {doc.source === "drive" && (
                          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-normal text-blue-300">
                            📁 Google Drive
                          </span>
                        )}
                        <RagStatusBadge doc={doc} />
                      </p>
                    )}
                    <p className="text-xs text-[#8a7c68]">
                      {doc.case_title || "No case"} · {formatDate(doc.uploaded_at)}
                    </p>
                  </div>
                </label>
                <div className="flex items-center gap-2">
                  {canEditDocument && editingRenameId !== doc.document_id && (
                    <>
                      <button
                        onClick={() => openEditor(doc)}
                        className="rounded-lg border border-[#c9a96e]/25 px-2 py-1 text-xs text-[#c9a96e] hover:bg-[#c9a96e]/10"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => startRename(doc)}
                        className="rounded-lg border border-[#c9a96e]/25 px-2 py-1 text-xs text-[#c9a96e] hover:bg-[#c9a96e]/10"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => handleForceRerun(doc)}
                        disabled={doc.status === "processing" || rerunningIds.has(doc.document_id)}
                        title="Re-run chunking and embedding for this document"
                        className="rounded-lg border border-[#c9a96e]/25 px-2 py-1 text-xs text-[#c9a96e] hover:bg-[#c9a96e]/10 disabled:opacity-50"
                      >
                        {rerunningIds.has(doc.document_id) ? "Starting..." : "Force re-run"}
                      </button>
                    </>
                  )}
                  {canDeleteDocument && (
                    <button
                      onClick={() => handleDelete(doc)}
                      className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && documents.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#8a7c68]">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, documents.length)} of {documents.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs text-[#8a7c68]">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {editingDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={closeEditor}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-[#c9a96e]/20 bg-[#0f0c08] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[#f0e6cc]">Edit document</h2>
                <p className="text-xs text-[#8a7c68]">{editingDoc.file_name}</p>
              </div>
              <button
                onClick={closeEditor}
                className="text-xs text-[#8a7c68] hover:text-[#c9a96e]"
              >
                Close
              </button>
            </div>

            {loadingContent ? (
              <p className="py-10 text-center text-sm text-[#8a7c68]">Loading document text...</p>
            ) : (
              <textarea
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                spellCheck={false}
                className="min-h-[45vh] flex-1 resize-none rounded-lg border border-[#c9a96e]/15 bg-[#14100a] p-3 font-mono text-sm leading-relaxed text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
              />
            )}

            <p className="mt-2 text-[11px] text-[#5a4f3f]">
              Edits are saved as the document&rsquo;s text and re-indexed for search and AI
              features. The original uploaded file is kept unchanged.
            </p>

            {contentError && (
              <p className="mt-2 text-xs text-red-400">{contentError}</p>
            )}

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={closeEditor}
                className="rounded-lg border border-[#c9a96e]/15 px-3 py-1.5 text-sm text-[#8a7c68]"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveContent}
                disabled={loadingContent || savingContent || !contentDraft.trim()}
                className="rounded-lg bg-[#c9a96e] px-4 py-1.5 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
              >
                {savingContent ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
