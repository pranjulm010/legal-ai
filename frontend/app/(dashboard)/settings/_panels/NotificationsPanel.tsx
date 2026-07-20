"use client";

import { useState } from "react";
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
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULTS);
  const [notice, setNotice] = useState<string | null>(null);

  const setField = (key: keyof NotificationSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setNotice(null);
  };

  const handleSave = () => {
    setNotice("Preview only - preferences aren't persisted to the server yet.");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Notifications</h1>
        <p className="text-sm text-[#8a7c68]">
          Firm-wide notification preferences - these apply to everyone at your firm.
        </p>
      </div>

      <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-xs text-[#c9a96e]">
        Preview - toggles below aren&apos;t saved to the server yet.
      </div>

      {notice && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="flex flex-col divide-y divide-[#c9a96e]/8">
          {ROWS.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm text-[#e0d2ba]">{row.label}</p>
                <p className="text-xs text-[#8a7c68]">{row.description}</p>
              </div>
              <Toggle checked={settings[row.key]} onChange={(next) => setField(row.key, next)} />
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={handleSave}
        className="self-start rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00]"
      >
        Save changes
      </button>
    </div>
  );
}
