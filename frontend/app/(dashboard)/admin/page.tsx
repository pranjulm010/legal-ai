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

type ActivityTone = "created" | "deleted" | "auth" | "neutral";

function toneForAction(action: string): ActivityTone {
  if (/(deleted|removed|disconnected|revoked|declined)/.test(action)) return "deleted";
  if (/(created|added|invited|connected|activated|saved|generated|uploaded)/.test(action))
    return "created";
  if (/(logged_in|logged_out|login|logout|signed_in|signed_out)/.test(action)) return "auth";
  return "neutral";
}

const TONE_DOT: Record<ActivityTone, string> = {
  created: "bg-emerald-400",
  deleted: "bg-red-400",
  auth: "bg-blue-400",
  neutral: "bg-[#c9a96e]",
};

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

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08]">
        <div className="flex items-center justify-between border-b border-[#c9a96e]/10 px-5 py-4">
          <h2 className="font-semibold text-[#f0e6cc]">Recent activity</h2>
          <span className="rounded-full border border-[#c9a96e]/15 px-2.5 py-0.5 text-xs text-[#8a7c68]">
            Audit log
          </span>
        </div>

        {data.recent_activity.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-[#5a4f3f]">
            No activity recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-[#c9a96e]/8">
            {data.recent_activity.map((log) => {
              const tone = toneForAction(log.action);
              return (
                <li
                  key={log.id}
                  className="flex items-start gap-3 px-5 py-3 transition hover:bg-[#c9a96e]/5"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[#cfc0a4]">
                      <span className="font-medium text-[#f0e6cc]">
                        {log.actor_name || "System"}
                      </span>{" "}
                      <span className="text-[#8a7c68]">{log.action.replace(/_/g, " ")}</span>
                      {log.details && (
                        <>
                          {" "}
                          <span className="text-[#e0d2ba]">{log.details}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <time className="shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-[#5a4f3f]">
                    {formatDate(log.created_at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
