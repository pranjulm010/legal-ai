"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  createLawyer,
  importLawyersCsv,
  listLawyers,
  removeLawyer,
  resendInvite,
  updateLawyer,
  type LawyerImportResult,
  type LawyerListItem,
} from "@/lib/api";

const ROLES = ["admin", "partner", "associate", "paralegal"];

export default function TeamPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [lawyers, setLawyers] = useState<LawyerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState("associate");
  const [department, setDepartment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<LawyerImportResult | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    setLoading(true);
    listLawyers()
      .then(setLawyers)
      .catch(() => setError("Failed to load team."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();

    // Invite completion (a lawyer setting their password) happens in a
    // different browser session, so this page's data goes stale the moment
    // that happens. Refetch whenever the admin comes back to this tab/page
    // instead of relying on a full reload.
    const handleFocus = () => load();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") load();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setInviteNotice(null);

    try {
      const result = await createLawyer({
        username,
        email,
        first_name: firstName,
        last_name: lastName,
        role,
        department,
      });
      setUsername("");
      setEmail("");
      setFirstName("");
      setLastName("");
      setRole("associate");
      setDepartment("");
      setShowForm(false);
      setInviteNotice(
        result.email_sent
          ? `Invite sent to ${result.email}.`
          : `Could not send the invite email. Share this link manually: ${result.invite_link}`
      );
      load();
    } catch (err: any) {
      setFormError(err?.response?.data?.error || "Failed to create lawyer.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRoleChange = async (lawyerId: number, newRole: string) => {
    try {
      await updateLawyer(lawyerId, { role: newRole });
      load();
    } catch (err: any) {
      const message = err?.response?.data?.error || "Failed to change role.";

      if (!message.includes("successor_id")) {
        alert(message);
        return;
      }

      const successorUsername = window.prompt(
        `${message}\n\nType the exact username of the lawyer who should become the new admin:`
      );
      if (!successorUsername) return;

      const successor = lawyers.find(
        (l) => l.username.toLowerCase() === successorUsername.trim().toLowerCase()
      );
      if (!successor) {
        alert("No lawyer found with that username.");
        return;
      }

      try {
        await updateLawyer(lawyerId, { role: newRole, successor_id: successor.id });
        load();
      } catch (err2: any) {
        alert(err2?.response?.data?.error || "Failed to change role.");
      }
    }
  };

  const handleToggleActive = async (lawyer: LawyerListItem) => {
    await updateLawyer(lawyer.id, { is_active: !lawyer.is_active });
    load();
  };

  const handleRemove = async (lawyer: LawyerListItem) => {
    if (!confirm(`Remove ${lawyer.full_name}? This cannot be undone.`)) return;
    await removeLawyer(lawyer.id);
    load();
  };

  const handleResendInvite = async (lawyer: LawyerListItem) => {
    setResendingId(lawyer.id);
    setInviteNotice(null);

    try {
      const result = await resendInvite(lawyer.id);
      setInviteNotice(
        result.email_sent
          ? `Invite re-sent to ${result.email}.`
          : `Could not send the invite email. Share this link manually: ${result.invite_link}`
      );
    } finally {
      setResendingId(null);
    }
  };

  const handleImportCsv = async (file: File) => {
    setImporting(true);
    setImportResult(null);

    try {
      const result = await importLawyersCsv(file);
      setImportResult(result);
      load();
    } finally {
      setImporting(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Team</h1>
        <div className="flex gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {isAdmin && (
            <>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleImportCsv(file);
              }}
            />
            <button
              onClick={() => csvInputRef.current?.click()}
              disabled={importing}
              className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
            >
              {importing ? "Importing..." : "Import CSV"}
            </button>
            <button
              onClick={() => setShowForm((prev) => !prev)}
              className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
            >
              {showForm ? "Cancel" : "+ Add lawyer"}
            </button>
            </>
          )}
        </div>
      </div>

      {!isAdmin && (
        <p className="text-sm text-[#5a4f3f]">
          Only firm admins can add lawyers or change roles. You can view the team below.
        </p>
      )}

      {isAdmin && (
        <p className="text-xs text-[#5a4f3f]">
          CSV format: a header row with <code>username</code> and <code>email</code> (required),
          and optional <code>first_name</code>, <code>last_name</code>, <code>role</code>,{" "}
          <code>department</code> columns.
        </p>
      )}

      {importResult && (
        <div className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-4 text-sm">
          <p className="text-[#e0d2ba]">
            Imported {importResult.created} lawyer(s), skipped {importResult.skipped}.
          </p>
          {importResult.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-[#8a7c68]">
              {importResult.errors.map((err, index) => (
                <li key={index}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {inviteNotice && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {inviteNotice}
        </div>
      )}

      {showForm && isAdmin && (
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-3 rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5 sm:flex-row sm:flex-wrap sm:items-end"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Username</label>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">First name</label>
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Last name</label>
            <input
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Role</label>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs text-[#8a7c68]">Department</label>
            <input
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
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

          {formError && (
            <p className="w-full text-sm text-red-300">{formError}</p>
          )}
        </form>
      )}

      {error && <p className="text-red-300">{error}</p>}

      {loading ? (
        <p className="text-[#8a7c68]">Loading team...</p>
      ) : lawyers.filter((lawyer) => lawyer.role !== "admin").length === 0 ? (
        <p className="text-[#8a7c68]">No team members yet. Add a lawyer to get started.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {/* Admins are the firm's owners/managers, not "team members" to
              manage here - exclude them from this list. */}
          {lawyers.filter((lawyer) => lawyer.role !== "admin").map((lawyer) => (
            <li
              key={lawyer.id}
              className="flex items-center justify-between rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] px-4 py-3"
            >
              <div>
                <p className="font-medium text-[#e0d2ba]">
                  {lawyer.full_name}{" "}
                  <span className="text-xs text-[#5a4f3f]">@{lawyer.username}</span>
                  {lawyer.invite_pending && (
                    <span className="ml-2 rounded-full bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
                      Invite pending
                    </span>
                  )}
                </p>
                <p className="text-xs text-[#8a7c68]">
                  {lawyer.email} · {lawyer.is_active ? "Active" : "Deactivated"}
                  {lawyer.department && ` · ${lawyer.department}`}
                </p>
                {isAdmin && (
                  <p className="text-xs text-[#5a4f3f]">
                    {lawyer.last_login
                      ? `Last login: ${new Date(lawyer.last_login).toLocaleString()}`
                      : "Last login: never signed in"}
                  </p>
                )}
              </div>

              {isAdmin ? (
                <div className="flex items-center gap-2">
                  {lawyer.invite_pending && (
                    <button
                      onClick={() => handleResendInvite(lawyer)}
                      disabled={resendingId === lawyer.id}
                      className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                    >
                      {resendingId === lawyer.id ? "Sending..." : "Resend invite"}
                    </button>
                  )}
                  <select
                    value={lawyer.role}
                    onChange={(event) => handleRoleChange(lawyer.id, event.target.value)}
                    className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-2 py-1 text-xs text-[#e0d2ba]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleToggleActive(lawyer)}
                    className="rounded-lg border border-[#c9a96e]/15 px-2 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                  >
                    {lawyer.is_active ? "Deactivate" : "Reactivate"}
                  </button>
                  <button
                    onClick={() => handleRemove(lawyer)}
                    className="rounded-lg border border-red-500/30 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <span className="text-xs text-[#8a7c68]">{lawyer.role}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
