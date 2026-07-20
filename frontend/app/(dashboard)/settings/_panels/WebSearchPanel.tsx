"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { getFirmProfile, updateFirmProfile, REGIONS, type FirmProfile } from "@/lib/api";
import { useRegisterSaveBar } from "../_lib/SaveBarContext";

export default function WebSearchPanel() {
  const { user, permissions } = useAuth();
  const canEdit = hasPermission(user?.role, "manage_team", permissions);

  const [profile, setProfile] = useState<FirmProfile | null>(null);
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFirmProfile()
      .then((p) => {
        setProfile(p);
        setSaved(p.default_region);
        setDraft(p.default_region);
      })
      .catch(() => setError("Failed to load web search configuration."))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = saved !== draft;

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateFirmProfile({ default_region: draft });
      setProfile(updated);
      setSaved(updated.default_region);
      setDraft(updated.default_region);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save web search configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(saved);

  useRegisterSaveBar(
    canEdit && profile
      ? { isDirty, saving, onSave: handleSave, onDiscard: handleDiscard, label: "Unsaved web search configuration." }
      : null
  );

  if (loading || !profile) {
    return <p className="text-[#8a7c68]">Loading web search configuration...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Web Search Configuration</h1>
        <p className="text-sm text-[#8a7c68]">
          When the AI asks to search the public web (because nothing relevant was found in your
          firm&apos;s documents), results are scoped to this region.
        </p>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <label className="text-xs text-[#8a7c68]">Default region</label>
          {canEdit ? (
            <select
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-[#e0d2ba]">
              {REGIONS.find((r) => r.value === draft)?.label || draft}
            </p>
          )}
        </div>
        {!canEdit && (
          <p className="mt-3 text-xs text-[#5a4f3f]">Only firm admins can change this.</p>
        )}
      </section>
    </div>
  );
}
