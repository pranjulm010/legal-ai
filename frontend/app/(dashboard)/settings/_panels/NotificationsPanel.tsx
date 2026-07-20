"use client";

import { useEffect, useState } from "react";
import { getFirmSettings, updateFirmSettings } from "@/lib/api";
import { useRegisterSaveBar } from "../_lib/SaveBarContext";
import Toggle from "../_components/Toggle";

interface NotificationSettings {
  documentUploaded: boolean;
  draftGenerated: boolean;
  teamMemberInvited: boolean;
  weeklyDigest: boolean;
  securityAlerts: boolean;
}

const DEFAULTS: NotificationSettings = {
  documentUploaded: true,
  draftGenerated: true,
  teamMemberInvited: true,
  weeklyDigest: false,
  securityAlerts: true,
};

const ROWS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: "documentUploaded", label: "Document uploaded", description: "Notify when a new document is added to the firm." },
  { key: "draftGenerated", label: "Draft generated", description: "Notify when the AI finishes generating a draft." },
  { key: "teamMemberInvited", label: "Team member invited", description: "Notify when a new lawyer is invited to the firm." },
  { key: "weeklyDigest", label: "Weekly activity digest", description: "A weekly summary email of firm activity." },
  { key: "securityAlerts", label: "Security alerts", description: "Notify on sign-ins from a new device or location." },
];

export default function NotificationsPanel() {
  const [saved, setSaved] = useState<NotificationSettings | null>(null);
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getFirmSettings()
      .then((data) => {
        const loaded: NotificationSettings = { ...DEFAULTS, ...(data.notifications || {}) };
        setSaved(loaded);
        setDraft(loaded);
      })
      .finally(() => setLoading(false));
  }, []);

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await updateFirmSettings("notifications", draft);
      setSaved(draft);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(saved);

  useRegisterSaveBar(
    draft
      ? { isDirty, saving, onSave: handleSave, onDiscard: handleDiscard, label: "Unsaved notification preferences." }
      : null
  );

  if (loading || !draft) {
    return <p className="text-[#8a7c68]">Loading notification preferences...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Notifications</h1>
        <p className="text-sm text-[#8a7c68]">
          Firm-wide notification preferences - these apply to everyone at your firm.
        </p>
      </div>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="flex flex-col divide-y divide-[#c9a96e]/8">
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm text-[#e0d2ba]">{row.label}</p>
                <p className="text-xs text-[#8a7c68]">{row.description}</p>
              </div>
              <Toggle
                checked={draft[row.key]}
                onChange={(next) => setDraft((prev) => (prev ? { ...prev, [row.key]: next } : prev))}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
