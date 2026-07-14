"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  exportDraft,
  getDraft,
  updateDraft,
  updateSuggestion,
  type DraftDetail,
} from "@/lib/api";

export default function DraftDetailPage() {
  const params = useParams<{ draftId: string }>();
  const draftId = params.draftId;

  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getDraft(draftId)
      .then((data) => {
        setDraft(data);
        setContent(data.content);
      })
      .finally(() => setLoading(false));
  }, [draftId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await updateDraft(draftId, { content });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const handleExport = async (format: "pdf" | "docx") => {
    if (!draft) return;
    setExporting(format);
    try {
      await exportDraft(draft.id, format, draft.title || "draft");
    } finally {
      setExporting(null);
    }
  };

  const handleSuggestionAction = async (
    suggestionId: number,
    status: "accepted" | "rejected"
  ) => {
    await updateSuggestion(suggestionId, status);
    load();
  };

  if (loading || !draft) {
    return <p className="text-[#8a7c68]">Loading draft...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#f0e6cc]">{draft.title}</h1>
          <p className="text-sm text-[#8a7c68]">
            {draft.draft_type === "draft" ? "Drafted document" : "Redline review"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            className="rounded-lg border border-[#c9a96e]/30 px-3 py-2 text-xs font-semibold text-[#c9a96e] disabled:opacity-50"
          >
            {exporting === "pdf" ? "Exporting..." : "Export PDF"}
          </button>
          <button
            onClick={() => handleExport("docx")}
            disabled={exporting !== null}
            className="rounded-lg border border-[#c9a96e]/30 px-3 py-2 text-xs font-semibold text-[#c9a96e] disabled:opacity-50"
          >
            {exporting === "docx" ? "Exporting..." : "Export DOCX"}
          </button>
        </div>
      </div>

      {draft.draft_type === "draft" ? (
        <div className="flex flex-col gap-3">
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={22}
            className="w-full rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 font-mono text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/40"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            {saved && <span className="text-xs text-[#8a7c68]">Saved.</span>}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#8a7c68]">{draft.content}</p>

          {draft.suggestions.length === 0 ? (
            <p className="text-sm text-[#5a4f3f]">No suggestions were generated.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {draft.suggestions.map((suggestion) => (
                <li
                  key={suggestion.id}
                  className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4"
                >
                  <div className="mb-2">
                    <p className="mb-1 text-xs text-[#5a4f3f]">Original</p>
                    <p className="rounded-lg bg-red-500/5 px-3 py-2 text-sm text-red-200 line-through decoration-red-400/50">
                      {suggestion.original_text}
                    </p>
                  </div>
                  <div className="mb-2">
                    <p className="mb-1 text-xs text-[#5a4f3f]">Suggested</p>
                    <p className="rounded-lg bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200">
                      {suggestion.suggested_text}
                    </p>
                  </div>
                  <p className="mb-3 text-xs text-[#8a7c68]">{suggestion.reason}</p>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSuggestionAction(suggestion.id, "accepted")}
                      disabled={suggestion.status === "accepted"}
                      className="rounded-lg border border-emerald-500/30 px-3 py-1 text-xs text-emerald-300 disabled:opacity-40"
                    >
                      {suggestion.status === "accepted" ? "Accepted" : "Accept"}
                    </button>
                    <button
                      onClick={() => handleSuggestionAction(suggestion.id, "rejected")}
                      disabled={suggestion.status === "rejected"}
                      className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 disabled:opacity-40"
                    >
                      {suggestion.status === "rejected" ? "Rejected" : "Reject"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
