"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  generateRedline,
  getCase,
  listCases,
  type CaseListItem,
  type DocumentRef,
} from "@/lib/api";

export default function RedlineDraftPage() {
  const router = useRouter();

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [caseId, setCaseId] = useState("");
  const [documents, setDocuments] = useState<DocumentRef[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCases().then(setCases);
  }, []);

  useEffect(() => {
    if (!caseId) {
      setDocuments([]);
      setDocumentId("");
      return;
    }

    setLoadingDocuments(true);
    getCase(caseId)
      .then((detail) => setDocuments(detail.documents))
      .finally(() => setLoadingDocuments(false));
  }, [caseId]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!documentId) return;

    setSubmitting(true);
    setError(null);

    try {
      const draft = await generateRedline({
        document_id: documentId,
        instructions,
        case_id: caseId || undefined,
      });
      router.push(`/drafts/${draft.id}`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to generate redline review.");
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-[#f0e6cc]">Redline a document</h1>

      <form
        onSubmit={handleSubmit}
        className="flex max-w-2xl flex-col gap-4 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
      >
        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Case</label>
          <select
            value={caseId}
            onChange={(event) => setCaseId(event.target.value)}
            required
            className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
          >
            <option value="">Select a case...</option>
            {cases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">Document</label>
          <select
            value={documentId}
            onChange={(event) => setDocumentId(event.target.value)}
            required
            disabled={!caseId || loadingDocuments}
            className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba] disabled:opacity-50"
          >
            <option value="">
              {loadingDocuments
                ? "Loading documents..."
                : !caseId
                ? "Select a case first"
                : documents.length === 0
                ? "No documents uploaded to this case"
                : "Select a document..."}
            </option>
            {documents.map((doc) => (
              <option key={doc.document_id} value={doc.document_id}>
                {doc.file_name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-[#8a7c68]">
            Review instructions (optional)
          </label>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
            placeholder="e.g. Focus on liability and termination clauses."
            className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
          />
        </div>

        <button
          type="submit"
          disabled={submitting || !documentId}
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {submitting ? "Reviewing..." : "Generate redline review"}
        </button>
      </form>
    </div>
  );
}
