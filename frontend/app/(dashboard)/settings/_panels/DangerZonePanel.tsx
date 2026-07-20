"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { listLawyers, removeLawyer, type LawyerListItem } from "@/lib/api";

export default function DangerZonePanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [deactivatingLawyers, setDeactivatingLawyers] = useState(false);
  const [lawyersNotice, setLawyersNotice] = useState<string | null>(null);

  const [confirmFirmName, setConfirmFirmName] = useState("");
  const [deactivatingFirm, setDeactivatingFirm] = useState(false);
  const [firmNotice, setFirmNotice] = useState<string | null>(null);

  const [lawyers, setLawyers] = useState<LawyerListItem[]>([]);
  const [loadingLawyers, setLoadingLawyers] = useState(true);
  const [selectedLawyerId, setSelectedLawyerId] = useState("");
  const [removingLawyer, setRemovingLawyer] = useState(false);
  const [removeNotice, setRemoveNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      setLoadingLawyers(false);
      return;
    }
    listLawyers()
      .then((data) => setLawyers(data.filter((lawyer) => lawyer.role !== "admin")))
      .catch(() => setRemoveNotice("Failed to load team."))
      .finally(() => setLoadingLawyers(false));
  }, [isAdmin]);

  const handleRemoveLawyer = async () => {
    const lawyer = lawyers.find((l) => String(l.id) === selectedLawyerId);
    if (!lawyer) return;
    if (!confirm(`Remove ${lawyer.full_name} (@${lawyer.username})? This cannot be undone.`)) return;

    setRemovingLawyer(true);
    setRemoveNotice(null);
    try {
      await removeLawyer(lawyer.id);
      setLawyers((prev) => prev.filter((l) => l.id !== lawyer.id));
      setSelectedLawyerId("");
      setRemoveNotice(`${lawyer.full_name} was removed.`);
    } catch (err: any) {
      setRemoveNotice(err?.response?.data?.error || "Failed to remove lawyer.");
    } finally {
      setRemovingLawyer(false);
    }
  };

  const handleDeactivateAllLawyers = () => {
    if (
      !confirm(
        "Deactivate every lawyer account at your firm except your own? They'll be signed out " +
          "and unable to log in until reactivated individually from Team Management."
      )
    ) {
      return;
    }

    setDeactivatingLawyers(true);
    setLawyersNotice(null);
    setTimeout(() => {
      setDeactivatingLawyers(false);
      setLawyersNotice("Preview only - no accounts were actually deactivated yet.");
    }, 500);
  };

  const handleDeactivateFirm = () => {
    if (confirmFirmName.trim() !== user?.firm_name) return;

    if (
      !confirm(
        `This would immediately block EVERY account at "${user?.firm_name}" - including your ` +
          "own - from logging in. Continue?"
      )
    ) {
      return;
    }

    setDeactivatingFirm(true);
    setFirmNotice(null);
    setTimeout(() => {
      setDeactivatingFirm(false);
      setFirmNotice("Preview only - your firm was not actually deactivated.");
    }, 500);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Danger Zone</h1>
        <p className="text-sm text-[#8a7c68]">Irreversible-feeling, firm-level actions.</p>
      </div>

      <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-xs text-[#c9a96e]">
        Removing a lawyer below is real and immediate. Deactivate-all and delete-firm are previews
        and aren&apos;t wired to the backend yet.
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-red-500/25 bg-red-500/5 p-5">
        <div className="border-b border-red-500/15 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#e0d2ba]">Remove an individual lawyer</p>
              <p className="text-xs text-[#8a7c68]">
                Permanently removes one lawyer&apos;s access to this firm. The same action is also
                available from Team Management.
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">Lawyer</label>
                <select
                  value={selectedLawyerId}
                  onChange={(e) => setSelectedLawyerId(e.target.value)}
                  disabled={loadingLawyers || lawyers.length === 0}
                  className="min-w-60 rounded-lg border border-red-500/30 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-red-400 disabled:opacity-50"
                >
                  <option value="">
                    {loadingLawyers
                      ? "Loading..."
                      : lawyers.length === 0
                        ? "No lawyers to remove"
                        : "Select a lawyer"}
                  </option>
                  {lawyers.map((lawyer) => (
                    <option key={lawyer.id} value={lawyer.id}>
                      {lawyer.full_name} (@{lawyer.username})
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleRemoveLawyer}
                disabled={!selectedLawyerId || removingLawyer}
                className="shrink-0 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {removingLawyer ? "Removing..." : "Remove lawyer"}
              </button>
            </div>
          )}
          {removeNotice && <p className="mt-2 text-xs text-[#c9a96e]">{removeNotice}</p>}
        </div>

        <div className="border-b border-red-500/15 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#e0d2ba]">Deactivate all lawyer accounts</p>
              <p className="text-xs text-[#8a7c68]">
                Suspends every account at your firm except your own. Reversible individually from
                Team Management.
              </p>
            </div>
            <button
              onClick={handleDeactivateAllLawyers}
              disabled={!isAdmin || deactivatingLawyers}
              className="shrink-0 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deactivatingLawyers ? "Deactivating..." : "Deactivate all"}
            </button>
          </div>
          {lawyersNotice && <p className="mt-2 text-xs text-[#c9a96e]">{lawyersNotice}</p>}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#e0d2ba]">Delete this firm</p>
              <p className="text-xs text-[#8a7c68]">
                Blocks every account at this firm from logging in, including your own. Data is
                kept, not destroyed - only a platform super-admin can restore access.
              </p>
            </div>
          </div>
          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">
                  Type your firm&apos;s exact name to confirm: <span className="text-[#e0d2ba]">{user?.firm_name}</span>
                </label>
                <input
                  value={confirmFirmName}
                  onChange={(e) => setConfirmFirmName(e.target.value)}
                  placeholder={user?.firm_name}
                  className="min-w-60 rounded-lg border border-red-500/30 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-red-400"
                />
              </div>
              <button
                onClick={handleDeactivateFirm}
                disabled={confirmFirmName.trim() !== user?.firm_name || deactivatingFirm}
                className="shrink-0 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deactivatingFirm ? "Deactivating..." : "Delete firm"}
              </button>
            </div>
          )}
          {firmNotice && <p className="mt-2 text-xs text-[#c9a96e]">{firmNotice}</p>}
        </div>
      </section>

      {!isAdmin && (
        <p className="text-xs text-[#5a4f3f]">
          Only firm admins can perform danger zone actions; you have view-only access.
        </p>
      )}
    </div>
  );
}
