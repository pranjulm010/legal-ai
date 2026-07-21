"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { deleteChatEntry, searchChatHistory, type ChatSearchResult } from "@/lib/api";

const PAGE_SIZE = 10;

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function KnowledgePage() {
  const { user } = useAuth();
  const canDeleteChat = hasPermission(user?.role, "delete_chat");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ChatSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = (q: string) => {
    setLoading(true);
    setPage(1);
    searchChatHistory(q)
      .then(setResults)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load("");
  }, []);

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault();
    load(query);
  };

  const handleDelete = async (result: ChatSearchResult) => {
    if (!confirm("Delete this question and answer? This cannot be undone.")) return;
    await deleteChatEntry(result.id);
    setResults((prev) => prev.filter((r) => r.id !== result.id));
  };

  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedResults = results.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Knowledge</h1>
        <p className="text-sm text-[#8a7c68]">
          Every question your firm has asked, searchable across all documents.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search past questions and answers..."
          className="flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
        >
          Search
        </button>
      </form>

      {loading ? (
        <p className="text-[#8a7c68]">Loading...</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-[#5a4f3f]">No past questions found.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {pagedResults.map((result) => {
            const card = (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs text-[#5a4f3f]">
                    {result.document_name || "General question"} · {formatDate(result.created_at)}
                  </p>
                  {canDeleteChat && (
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDelete(result);
                      }}
                      className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p className="mb-2 font-medium text-[#e0d2ba]">{result.question}</p>
                <p className="text-sm text-[#8a7c68] line-clamp-3">{result.answer}</p>
                {result.chat_session_id && (
                  <p className="mt-2 text-xs text-[#c9a96e]">Click to resume this chat →</p>
                )}
              </>
            );

            return (
              <li key={result.id}>
                {result.chat_session_id ? (
                  <Link
                    href={`/app?session=${result.chat_session_id}`}
                    className="block rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 transition hover:border-[#c9a96e]/35 hover:bg-[#c9a96e]/5"
                  >
                    {card}
                  </Link>
                ) : (
                  <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4">
                    {card}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!loading && results.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#8a7c68]">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, results.length)} of {results.length}
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
