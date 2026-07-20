"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  getFirmProfile,
  updateFirmProfile,
  uploadFirmLogo,
  type FirmProfile,
} from "@/lib/api";
import { useRegisterSaveBar } from "../_lib/SaveBarContext";

type DraftFields = Pick<
  FirmProfile,
  | "bar_registration_number"
  | "address"
  | "official_email_domain"
  | "practice_areas"
  | "employee_count"
  | "lawyer_count"
  | "office_locations"
  | "phone"
  | "website"
  | "gst_number"
>;

function toDraft(profile: FirmProfile): DraftFields {
  return {
    bar_registration_number: profile.bar_registration_number,
    address: profile.address,
    official_email_domain: profile.official_email_domain,
    practice_areas: profile.practice_areas,
    employee_count: profile.employee_count,
    lawyer_count: profile.lawyer_count,
    office_locations: profile.office_locations,
    phone: profile.phone,
    website: profile.website,
    gst_number: profile.gst_number,
  };
}

const FIELD_LABELS: Record<keyof DraftFields, string> = {
  bar_registration_number: "Bar registration number",
  address: "Address",
  official_email_domain: "Official email domain",
  practice_areas: "Practice areas",
  employee_count: "Employee count",
  lawyer_count: "Lawyer count",
  office_locations: "Office locations",
  phone: "Phone",
  website: "Website",
  gst_number: "GST number",
};

export default function WorkspacePanel() {
  const { user, permissions } = useAuth();
  const canEdit = hasPermission(user?.role, "manage_team", permissions);

  const [profile, setProfile] = useState<FirmProfile | null>(null);
  const [saved, setSaved] = useState<DraftFields | null>(null);
  const [draft, setDraft] = useState<DraftFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getFirmProfile()
      .then((p) => {
        setProfile(p);
        setSaved(toDraft(p));
        setDraft(toDraft(p));
      })
      .catch(() => setError("Failed to load firm profile."))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateFirmProfile(draft);
      setProfile(updated);
      setSaved(toDraft(updated));
      setDraft(toDraft(updated));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save firm profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(saved);

  useRegisterSaveBar(
    canEdit && draft
      ? { isDirty, saving, onSave: handleSave, onDiscard: handleDiscard, label: "Unsaved workspace changes." }
      : null
  );

  const handleUploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const updated = await uploadFirmLogo(file);
      setProfile(updated);
    } finally {
      setUploadingLogo(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  const setField = <K extends keyof DraftFields>(key: K, value: DraftFields[K]) => {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  if (loading || !profile || !draft) {
    return <p className="text-[#8a7c68]">Loading workspace...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#f0e6cc]">Workspace</h1>
          <p className="text-sm text-[#8a7c68]">Firm profile, branding, and contact details.</p>
        </div>
        {canEdit && (
          <>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleUploadLogo(file);
              }}
            />
            <button
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-xs text-[#c9a96e] disabled:opacity-50"
            >
              {profile.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.logo_url} alt="Firm logo" className="h-6 w-6 rounded object-cover" />
              )}
              {uploadingLogo ? "Uploading..." : "Upload logo"}
            </button>
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {!canEdit && (
        <p className="text-sm text-[#5a4f3f]">
          Only firm admins can edit the workspace profile. You can view it below.
        </p>
      )}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(FIELD_LABELS) as (keyof DraftFields)[]).map((fieldKey) => (
            <div key={fieldKey} className="flex flex-col gap-1">
              <label className="text-xs text-[#8a7c68]">{FIELD_LABELS[fieldKey]}</label>
              {!canEdit ? (
                <p className="text-sm text-[#e0d2ba]">{String(draft[fieldKey] || "Not set")}</p>
              ) : fieldKey === "employee_count" || fieldKey === "lawyer_count" ? (
                <input
                  type="number"
                  min={0}
                  value={draft[fieldKey]}
                  onChange={(event) => setField(fieldKey, Number(event.target.value) as any)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              ) : (
                <input
                  value={draft[fieldKey] as string}
                  onChange={(event) => setField(fieldKey, event.target.value as any)}
                  className="rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                />
              )}
            </div>
          ))}
          <p className="text-xs text-[#5a4f3f] sm:col-span-2">
            Active accounts: {profile.active_lawyer_count}
          </p>
        </div>
      </section>
    </div>
  );
}
