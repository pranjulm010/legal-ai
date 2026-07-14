"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { deleteDraft, listDrafts, type DraftListItem } from "@/lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function DraftsPage() {
  const { user } = useAuth();
  const canGenerateDraft = hasPermission(user?.role, "generate_draft");
  const canDeleteDraft = hasPermission(user?.role, "delete_draft");

  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    listDrafts()
      .then(setDrafts)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (draft: DraftListItem) => {
    if (!confirm(`Delete "${draft.title}"? This cannot be undone.`)) return;
    await deleteDraft(draft.id);
    load();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Drafts</h1>
        {canGenerateDraft && (
          <div className="flex gap-2">
            <Link
              href="/drafts/new"
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
            >
              + New draft
            </Link>
            <Link
              href="/drafts/redline"
              className="rounded-lg border border-[#c9a96e]/30 px-4 py-2 text-sm font-semibold text-[#c9a96e]"
            >
              Redline a document
            </Link>
          </div>
        )}
      </div>

      {!canGenerateDraft && (
        <p className="text-sm text-[#5a4f3f]">
          Your role doesn't have permission to generate drafts or redlines. You can view existing drafts below.
        </p>
      )}

      {loading ? (
        <p className="text-[#8a7c68]">Loading drafts...</p>
      ) : drafts.length === 0 ? (
        <p className="text-[#5a4f3f]">
          No drafts yet. Generate a new document or redline an uploaded contract.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex items-center gap-2 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3 hover:border-[#c9a96e]/30"
            >
              <Link href={`/drafts/${draft.id}`} className="flex flex-1 items-center justify-between">
                <div>
                  <p className="font-medium text-[#e0d2ba]">{draft.title}</p>
                  <p className="text-xs text-[#8a7c68]">
                    {draft.draft_type === "draft" ? "Drafted document" : "Redline review"}
                  </p>
                </div>
                <span className="text-xs text-[#8a7c68]">
                  Updated {formatDate(draft.updated_at)}
                </span>
              </Link>
              {canDeleteDraft && (
                <button
                  onClick={() => handleDelete(draft)}
                  className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
