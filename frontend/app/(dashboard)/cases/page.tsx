"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { createCase, listCases, type CaseListItem } from "@/lib/api";

const CASE_TYPES = ["civil", "criminal", "corporate", "family", "property", "other"];
const STATUSES = ["open", "in_progress", "on_hold", "closed"];
const PAGE_SIZE = 10;

function formatLabel(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export default function CasesPage() {
  const { user } = useAuth();
  const canCreateCase = hasPermission(user?.role, "create_case");

  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [caseType, setCaseType] = useState("other");
  const [clientName, setClientName] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [page, setPage] = useState(1);

  const load = (status?: string) => {
    setLoading(true);
    setPage(1);
    listCases(status ? { status } : undefined)
      .then(setCases)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(statusFilter || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await createCase({ title, case_type: caseType, client_name: clientName });
      setTitle("");
      setClientName("");
      setCaseType("other");
      setShowForm(false);
      load(statusFilter || undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(cases.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedCases = cases.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Cases</h1>
        {canCreateCase && (
          <button
            onClick={() => setShowForm((prev) => !prev)}
            className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
          >
            {showForm ? "Cancel" : "+ New case"}
          </button>
        )}
      </div>

      {showForm && canCreateCase && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5 sm:flex-row sm:items-end sm:flex-wrap"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Title</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Case type</label>
            <select
              value={caseType}
              onChange={(event) => setCaseType(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            >
              {CASE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {formatLabel(type)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Client name</label>
            <input
              value={clientName}
              onChange={(event) => setClientName(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </form>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => setStatusFilter("")}
          className={`rounded-full px-3 py-1 text-xs ${
            statusFilter === ""
              ? "bg-[#c9a96e]/20 text-[#f0e6cc]"
              : "text-[#8a7c68] hover:text-[#c9a96e]"
          }`}
        >
          All
        </button>
        {STATUSES.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-full px-3 py-1 text-xs ${
              statusFilter === status
                ? "bg-[#c9a96e]/20 text-[#f0e6cc]"
                : "text-[#8a7c68] hover:text-[#c9a96e]"
            }`}
          >
            {formatLabel(status)}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-[#8a7c68]">Loading cases...</p>
      ) : cases.length === 0 ? (
        <p className="text-[#5a4f3f]">No cases found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pagedCases.map((c) => (
            <li key={c.id}>
              <Link
                href={`/cases/${c.id}`}
                className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3 hover:border-[#c9a96e]/30"
              >
                <div>
                  <p className="font-medium text-[#e0d2ba]">{c.title}</p>
                  <p className="text-xs text-[#8a7c68]">
                    {formatLabel(c.case_type)} · {c.client_name || "No client name"}
                  </p>
                </div>
                <div className="text-right text-xs text-[#8a7c68]">
                  <p>{formatLabel(c.status)}</p>
                  <p>
                    {c.open_reminders_count} open reminder
                    {c.open_reminders_count === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && cases.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#8a7c68]">
            Showing {(currentPage - 1) * PAGE_SIZE + 1}–
            {Math.min(currentPage * PAGE_SIZE, cases.length)} of {cases.length}
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
