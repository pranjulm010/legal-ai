"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { deactivateAllLawyers, deactivateFirm } from "@/lib/api";

export default function DangerZonePanel() {
  const { user, permissions, logout } = useAuth();
  const router = useRouter();
  const isAdmin = hasPermission(user?.role, "manage_team", permissions);

  const [deactivatingLawyers, setDeactivatingLawyers] = useState(false);
  const [lawyersNotice, setLawyersNotice] = useState<string | null>(null);
  const [lawyersError, setLawyersError] = useState<string | null>(null);

  const [confirmFirmName, setConfirmFirmName] = useState("");
  const [deactivatingFirm, setDeactivatingFirm] = useState(false);
  const [firmError, setFirmError] = useState<string | null>(null);

  const handleDeactivateAllLawyers = async () => {
    if (
      !confirm(
        "Deactivate every lawyer account at your firm except your own? They'll be signed out " +
          "and unable to log in until reactivated individually from Team Management."
      )
    ) {
      return;
    }

    setDeactivatingLawyers(true);
    setLawyersError(null);
    setLawyersNotice(null);
    try {
      const result = await deactivateAllLawyers();
      setLawyersNotice(
        result.deactivated_count > 0
          ? `Deactivated ${result.deactivated_count} lawyer account(s). Reactivate them individually from Team Management.`
          : "No other active lawyer accounts to deactivate."
      );
    } catch (err: any) {
      setLawyersError(err?.response?.data?.error || "Failed to deactivate lawyer accounts.");
    } finally {
      setDeactivatingLawyers(false);
    }
  };

  const handleDeactivateFirm = async () => {
    if (confirmFirmName.trim() !== user?.firm_name) return;

    if (
      !confirm(
        `This will immediately block EVERY account at "${user?.firm_name}" - including your own - ` +
          "from logging in. This is not reversible from within the app; you'll need to contact " +
          "platform support to reactivate. Continue?"
      )
    ) {
      return;
    }

    setDeactivatingFirm(true);
    setFirmError(null);
    try {
      await deactivateFirm(confirmFirmName.trim());
      logout();
      router.push("/login");
    } catch (err: any) {
      setFirmError(err?.response?.data?.error || "Failed to deactivate the firm.");
      setDeactivatingFirm(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Danger Zone</h1>
        <p className="text-sm text-[#8a7c68]">Irreversible-feeling, firm-level actions.</p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-red-500/25 bg-red-500/5 p-5">
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
          {lawyersError && <p className="mt-2 text-xs text-red-300">{lawyersError}</p>}
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-[#e0d2ba]">Delete this firm</p>
              <p className="text-xs text-[#8a7c68]">
                Blocks every account at this firm from logging in, including your own. Your data
                is kept, not destroyed - only a platform super-admin can restore access.
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
          {firmError && <p className="mt-2 text-xs text-red-300">{firmError}</p>}
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
