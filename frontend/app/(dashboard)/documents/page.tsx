"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  analyzeDocumentRisks,
  checkDocumentCompliance,
  compareDocuments,
  deleteDocument,
  extractDocumentEntities,
  generateClientSummary,
  listDocuments,
  summarizeDocument,
  updateDocumentTags,
  type ComplianceFinding,
  type DocumentListItem,
  type EntityExtraction,
  type RiskItem,
} from "@/lib/api";

type DocAction = "summarize" | "client-summary" | "risks" | "entities" | "compliance";

const ACTION_LABELS: Record<DocAction, string> = {
  summarize: "Summarize",
  "client-summary": "Client summary",
  risks: "Risk analysis",
  entities: "Extract entities",
  compliance: "Compliance check",
};

type DocResult =
  | { documentId: string; action: "summarize" | "client-summary"; data: string }
  | { documentId: string; action: "risks"; data: RiskItem[] }
  | { documentId: string; action: "entities"; data: EntityExtraction }
  | { documentId: string; action: "compliance"; data: ComplianceFinding[] };

const PAGE_SIZE = 10;

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

const SEVERITY_COLOR: Record<string, string> = {
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-green-400",
};

const STATUS_COLOR: Record<string, string> = {
  present: "text-green-400",
  weak: "text-yellow-400",
  missing: "text-red-400",
};

export default function DocumentsPage() {
  const { user } = useAuth();
  const canDeleteDocument = hasPermission(user?.role, "delete_document");

  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState("");
  const [page, setPage] = useState(1);

  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");

  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [docResult, setDocResult] = useState<DocResult | null>(null);

  const [compareSelection, setCompareSelection] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState<string | null>(null);

  const load = (tag?: string) => {
    setLoading(true);
    setPage(1);
    listDocuments(tag ? { tag } : undefined)
      .then(setDocuments)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleFilter = (event: React.FormEvent) => {
    event.preventDefault();
    load(tagFilter || undefined);
  };

  const handleSaveTags = async (documentId: string) => {
    const updated = await updateDocumentTags(documentId, tagsDraft);
    setDocuments((prev) =>
      prev.map((doc) => (doc.document_id === documentId ? updated : doc))
    );
    setEditingTagsId(null);
  };

  const handleDelete = async (doc: DocumentListItem) => {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return;
    await deleteDocument(doc.document_id);
    setCompareSelection((prev) => prev.filter((id) => id !== doc.document_id));
    load();
  };

  const handleRunAction = async (doc: DocumentListItem, action: DocAction) => {
    const key = `${doc.document_id}:${action}`;
    setRunningAction(key);
    setDocResult(null);

    try {
      if (action === "summarize") {
        const data = await summarizeDocument(doc.document_id);
        setDocResult({ documentId: doc.document_id, action, data });
      } else if (action === "client-summary") {
        const data = await generateClientSummary(doc.document_id);
        setDocResult({ documentId: doc.document_id, action, data });
      } else if (action === "risks") {
        const data = await analyzeDocumentRisks(doc.document_id);
        setDocResult({ documentId: doc.document_id, action, data });
      } else if (action === "entities") {
        const data = await extractDocumentEntities(doc.document_id);
        setDocResult({ documentId: doc.document_id, action, data });
      } else {
        const data = await checkDocumentCompliance(doc.document_id);
        setDocResult({ documentId: doc.document_id, action, data });
      }
    } finally {
      setRunningAction(null);
    }
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
          Every document uploaded across your firm - tag, summarize, analyze risk, extract
          entities, check compliance, or compare any two.
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
                    <p className="flex items-center gap-2 font-medium text-[#e0d2ba]">
                      {doc.file_name}
                      {doc.source === "drive" && (
                        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-normal text-blue-300">
                          📁 Google Drive
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#8a7c68]">
                      {doc.case_title || "No case"} · {formatDate(doc.uploaded_at)}
                    </p>
                  </div>
                </label>
                {canDeleteDocument && (
                  <button
                    onClick={() => handleDelete(doc)}
                    className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Delete
                  </button>
                )}
              </div>

              <div className="mt-2">
                {editingTagsId === doc.document_id ? (
                  <div className="flex gap-2">
                    <input
                      value={tagsDraft}
                      onChange={(event) => setTagsDraft(event.target.value)}
                      placeholder="tag1, tag2"
                      className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-2 py-1 text-xs text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                    />
                    <button
                      onClick={() => handleSaveTags(doc.document_id)}
                      className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#c9a96e]"
                    >
                      Save
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingTagsId(doc.document_id);
                      setTagsDraft(doc.tags);
                    }}
                    className="text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                  >
                    {doc.tags ? `Tags: ${doc.tags}` : "+ Add tags"}
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {(Object.keys(ACTION_LABELS) as DocAction[]).map((action) => (
                  <button
                    key={action}
                    onClick={() => handleRunAction(doc, action)}
                    disabled={runningAction === `${doc.document_id}:${action}`}
                    className="rounded-full border border-[#c9a96e]/15 px-3 py-1 text-[11px] text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                  >
                    {runningAction === `${doc.document_id}:${action}`
                      ? "..."
                      : ACTION_LABELS[action]}
                  </button>
                ))}
              </div>

              {docResult && docResult.documentId === doc.document_id && (
                <div className="mt-3 rounded-lg border border-[#c9a96e]/15 bg-[#14100a] p-3 text-sm">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-semibold text-[#c9a96e]">
                      {ACTION_LABELS[docResult.action]}
                    </p>
                    <button
                      onClick={() => setDocResult(null)}
                      className="text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                    >
                      Close
                    </button>
                  </div>

                  {(docResult.action === "summarize" || docResult.action === "client-summary") && (
                    <p className="whitespace-pre-wrap text-[#cfc0a4]">{docResult.data}</p>
                  )}

                  {docResult.action === "risks" && (
                    docResult.data.length === 0 ? (
                      <p className="text-[#5a4f3f]">No significant risks found.</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {docResult.data.map((riskItem, index) => (
                          <li key={index} className="border-t border-[#c9a96e]/10 pt-2 first:border-t-0 first:pt-0">
                            <p className={`text-xs font-semibold ${SEVERITY_COLOR[riskItem.severity] || "text-[#8a7c68]"}`}>
                              {riskItem.severity.toUpperCase()}
                            </p>
                            <p className="text-[#cfc0a4]">&ldquo;{riskItem.clause_excerpt}&rdquo;</p>
                            <p className="text-xs text-[#8a7c68]">{riskItem.risk}</p>
                          </li>
                        ))}
                      </ul>
                    )
                  )}

                  {docResult.action === "entities" && (
                    <div className="grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                      <p><span className="text-[#5a4f3f]">Case number:</span> {docResult.data.case_number || "—"}</p>
                      <p><span className="text-[#5a4f3f]">Court:</span> {docResult.data.court_name || "—"}</p>
                      <p className="sm:col-span-2"><span className="text-[#5a4f3f]">Parties:</span> {docResult.data.parties.join(", ") || "—"}</p>
                      <p className="sm:col-span-2"><span className="text-[#5a4f3f]">Dates:</span> {docResult.data.dates.join(", ") || "—"}</p>
                      <p className="sm:col-span-2"><span className="text-[#5a4f3f]">Amounts:</span> {docResult.data.amounts.join(", ") || "—"}</p>
                      <p className="sm:col-span-2"><span className="text-[#5a4f3f]">Sections referenced:</span> {docResult.data.sections_referenced.join(", ") || "—"}</p>
                      <p className="sm:col-span-2"><span className="text-[#5a4f3f]">Addresses:</span> {docResult.data.addresses.join(", ") || "—"}</p>
                    </div>
                  )}

                  {docResult.action === "compliance" && (
                    <ul className="flex flex-col gap-1.5">
                      {docResult.data.map((finding, index) => (
                        <li key={index} className="text-xs">
                          <span className={`font-semibold ${STATUS_COLOR[finding.status] || "text-[#8a7c68]"}`}>
                            {finding.status.toUpperCase()}
                          </span>{" "}
                          <span className="text-[#cfc0a4]">{finding.item}</span>
                          {finding.note && <span className="text-[#5a4f3f]"> — {finding.note}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
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
    </div>
  );
}
