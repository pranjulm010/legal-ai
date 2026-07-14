"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { getAdminDashboard, type AdminDashboard } from "@/lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
      <p className="text-2xl font-bold text-[#f0e6cc]">{value}</p>
      <p className="text-xs text-[#8a7c68]">{label}</p>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    getAdminDashboard()
      .then(setData)
      .catch(() => setError("Failed to load admin dashboard."))
      .finally(() => setLoading(false));
  }, [isAdmin]);

  if (!isAdmin) {
    return (
      <p className="text-sm text-[#5a4f3f]">
        Only firm admins can view the admin dashboard.
      </p>
    );
  }

  if (loading) {
    return <p className="text-[#8a7c68]">Loading admin dashboard...</p>;
  }

  if (error || !data) {
    return <p className="text-red-300">{error || "Failed to load."}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-[#f0e6cc]">Admin Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total users" value={data.total_users} />
        <StatCard label="Active users" value={data.active_users} />
        <StatCard label="Pending invitations" value={data.pending_invitations} />
        <StatCard label="Documents uploaded" value={data.documents_uploaded} />
        <StatCard label="AI queries" value={data.ai_queries} />
        <StatCard label="Drafts generated" value={data.drafts_generated} />
      </div>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">Recent activity (audit log)</h2>

        {data.recent_activity.length === 0 ? (
          <p className="text-sm text-[#5a4f3f]">No activity recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.recent_activity.map((log) => (
              <li key={log.id} className="text-xs text-[#8a7c68]">
                {formatDate(log.created_at)} — <span className="text-[#c9a96e]">{log.actor_name || "System"}</span>{" "}
                {log.action.replace(/_/g, " ")}
                {log.details && `: ${log.details}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
