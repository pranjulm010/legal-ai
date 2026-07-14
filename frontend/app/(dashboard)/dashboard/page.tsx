"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getDashboardSummary,
  type DashboardSummary,
} from "@/lib/api";

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  on_hold: "On Hold",
  closed: "Closed",
};

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch(() => setError("Failed to load dashboard."));
  }, []);

  if (error) {
    return <p className="text-red-300">{error}</p>;
  }

  if (!summary) {
    return <p className="text-[#8a7c68]">Loading dashboard...</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Dashboard</h1>
        <p className="text-sm text-[#8a7c68]">
          {summary.total_cases} case{summary.total_cases === 1 ? "" : "s"} total
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Object.entries(summary.case_counts_by_status).map(([status, count]) => (
          <div
            key={status}
            className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4"
          >
            <p className="text-2xl font-bold text-[#f0e6cc]">{count}</p>
            <p className="text-xs text-[#8a7c68]">
              {STATUS_LABELS[status] || status}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">
            Overdue reminders ({summary.overdue_reminders.length})
          </h2>

          {summary.overdue_reminders.length === 0 ? (
            <p className="text-sm text-[#5a4f3f]">Nothing overdue.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.overdue_reminders.map((reminder) => (
                <li
                  key={reminder.id}
                  className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/cases/${reminder.case_id}`}
                    className="font-medium text-red-300 hover:underline"
                  >
                    {reminder.title}
                  </Link>
                  <p className="text-xs text-[#8a7c68]">
                    {reminder.case_title} · due {formatDate(reminder.due_date)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">
            Upcoming reminders ({summary.upcoming_reminders.length})
          </h2>

          {summary.upcoming_reminders.length === 0 ? (
            <p className="text-sm text-[#5a4f3f]">No upcoming reminders.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {summary.upcoming_reminders.map((reminder) => (
                <li
                  key={reminder.id}
                  className="rounded-lg border border-[#c9a96e]/12 bg-[#c9a96e]/5 px-3 py-2 text-sm"
                >
                  <Link
                    href={`/cases/${reminder.case_id}`}
                    className="font-medium text-[#c9a96e] hover:underline"
                  >
                    {reminder.title}
                  </Link>
                  <p className="text-xs text-[#8a7c68]">
                    {reminder.case_title} · due {formatDate(reminder.due_date)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">Recently updated cases</h2>

        {summary.recent_cases.length === 0 ? (
          <p className="text-sm text-[#5a4f3f]">
            No cases yet.{" "}
            <Link href="/cases" className="text-[#c9a96e] hover:underline">
              Create one
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {summary.recent_cases.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/cases/${c.id}`}
                  className="flex items-center justify-between rounded-lg border border-[#c9a96e]/10 px-3 py-2 text-sm hover:border-[#c9a96e]/30"
                >
                  <span className="text-[#e0d2ba]">{c.title}</span>
                  <span className="text-xs text-[#8a7c68]">
                    {STATUS_LABELS[c.status] || c.status} · {c.open_reminders_count} open reminder
                    {c.open_reminders_count === 1 ? "" : "s"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
