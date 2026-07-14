"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearSuperAdminToken,
  deleteFirm,
  getPlatformStats,
  getSuperAdminToken,
  listAllFirms,
  updateFirmStatus,
  type FirmSummary,
  type PlatformStats,
} from "@/lib/superAdminApi";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
      <p className="text-2xl font-bold text-[#f0e6cc]">{value}</p>
      <p className="text-xs text-[#8a7c68]">{label}</p>
    </div>
  );
}

export default function SuperAdminDashboardPage() {
  const router = useRouter();

  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [firms, setFirms] = useState<FirmSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([getPlatformStats(), listAllFirms()])
      .then(([statsData, firmsData]) => {
        setStats(statsData);
        setFirms(firmsData);
      })
      .catch((err) => {
        if (err?.response?.status === 401) {
          router.replace("/super-admin/login");
          return;
        }
        setError("Failed to load platform data.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!getSuperAdminToken()) {
      router.replace("/super-admin/login");
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleActive = async (firm: FirmSummary) => {
    await updateFirmStatus(firm.id, { is_active: !firm.is_active });
    load();
  };

  const handleDelete = async (firm: FirmSummary) => {
    if (
      !confirm(
        `Permanently delete "${firm.name}"? This removes all its cases, documents, drafts, and lawyer accounts. This cannot be undone.`
      )
    )
      return;
    await deleteFirm(firm.id);
    load();
  };

  const handleLogout = () => {
    clearSuperAdminToken();
    router.push("/super-admin/login");
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0906] text-[#8a7c68]">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0906] p-8 text-[#e0d2ba]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[#f0e6cc]">🛡️ Super Admin — All Firms</h1>
          <button
            onClick={handleLogout}
            className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#8a7c68] hover:text-[#c9a96e]"
          >
            Log out
          </button>
        </div>

        {error && <p className="text-red-300">{error}</p>}

        {stats && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <StatCard label="Total firms" value={stats.total_firms} />
            <StatCard label="Active firms" value={stats.active_firms} />
            <StatCard label="Total lawyers" value={stats.total_lawyers} />
            <StatCard label="Documents" value={stats.total_documents} />
            <StatCard label="AI queries" value={stats.total_ai_queries} />
            <StatCard label="Drafts" value={stats.total_drafts} />
          </div>
        )}

        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Firms</h2>

          {firms.length === 0 ? (
            <p className="text-sm text-[#5a4f3f]">No firms found.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {firms.map((firm) => (
                <li
                  key={firm.id}
                  className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#14100a] px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-[#e0d2ba]">
                      {firm.name}{" "}
                      {!firm.is_active && (
                        <span className="ml-2 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-300">
                          Suspended
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-[#8a7c68]">
                      {firm.size} · {firm.lawyer_count} lawyer(s) ({firm.active_lawyer_count}{" "}
                      active) · {firm.case_count} case(s) · {firm.document_count} document(s) ·{" "}
                      {firm.draft_count} draft(s) · created {formatDate(firm.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(firm)}
                      className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                    >
                      {firm.is_active ? "Suspend" : "Reactivate"}
                    </button>
                    <button
                      onClick={() => handleDelete(firm)}
                      className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
