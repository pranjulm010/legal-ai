"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  deleteDocument,
  getDocumentStatus,
  listDocuments,
  type DocumentListItem,
  type DocumentStatus,
} from "@/lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const STATUS_COLOR: Record<string, string> = {
  ready: "text-green-400",
  processing: "text-yellow-400",
  failed: "text-red-400",
};

export default function KnowledgeBasePanel() {
  const { user } = useAuth();
  const canDelete = user?.role === "admin" || user?.role === "partner";

  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [statuses, setStatuses] = useState<Record<string, DocumentStatus>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    listDocuments()
      .then(setDocuments)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCheckStatus = async (documentId: string) => {
    setCheckingId(documentId);
    try {
      const status = await getDocumentStatus(documentId);
      setStatuses((prev) => ({ ...prev, [documentId]: status }));
    } finally {
      setCheckingId(null);
    }
  };

  const handleDelete = async (doc: DocumentListItem) => {
    if (!confirm(`Delete "${doc.file_name}" from the knowledge base? This cannot be undone.`)) return;
    await deleteDocument(doc.document_id);
    load();
  };

  const filtered = documents.filter((doc) =>
    doc.file_name.toLowerCase().includes(query.toLowerCase())
  );

  const totalChunks = Object.values(statuses).reduce((sum, s) => sum + (s.total_chunks || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Knowledge Base</h1>
        <p className="text-sm text-[#8a7c68]">
          Every document indexed into your firm&apos;s vector database. Check a document&apos;s
          status to see how many chunks it was embedded into.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 text-sm">
        <span className="text-[#8a7c68]">Indexed documents:</span>
        <span className="text-[#e0d2ba]">{documents.length}</span>
        <span className="text-[#5a4f3f]">·</span>
        <span className="text-[#8a7c68]">Checked chunk count (this session):</span>
        <span className="text-[#e0d2ba]">{totalChunks}</span>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search indexed documents by name..."
        className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
      />

      {loading ? (
        <p className="text-[#8a7c68]">Loading knowledge base...</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-[#5a4f3f]">No documents found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((doc) => {
            const status = statuses[doc.document_id];
            return (
              <li
                key={doc.document_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3"
              >
                <div>
                  <p className="font-medium text-[#e0d2ba]">
                    {doc.file_name}
                    {doc.source === "drive" && (
                      <span className="ml-2 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-normal text-blue-300">
                        📁 Google Drive
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-[#8a7c68]">
                    {doc.case_title || "No case"} · {formatDate(doc.uploaded_at)}
                  </p>
                  {status && (
                    <p className="mt-1 text-xs">
                      <span className={STATUS_COLOR[status.status] || "text-[#8a7c68]"}>
                        {status.status.toUpperCase()}
                      </span>{" "}
                      <span className="text-[#5a4f3f]">
                        · {status.total_chunks} vector chunk(s)
                        {status.error_message && ` · ${status.error_message}`}
                      </span>
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleCheckStatus(doc.document_id)}
                    disabled={checkingId === doc.document_id}
                    className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                  >
                    {checkingId === doc.document_id ? "Checking..." : "Check vector status"}
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(doc)}
                      className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
