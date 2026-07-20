"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { getFirmSettings, updateFirmSettings } from "@/lib/api";
import { useRegisterSaveBar } from "../_lib/SaveBarContext";
import Toggle from "../_components/Toggle";

interface OcrSettings {
  lang: string;
  auto_ocr: boolean;
}

const DEFAULTS: OcrSettings = { lang: "eng", auto_ocr: true };

// Real Tesseract language codes - passed straight to pytesseract's `lang`
// argument (see rag/document_processor.py's _resolve_ocr_settings). Only
// "eng" is confirmed installed on this server right now; picking another
// will make OCR fail with a Tesseract error until its language pack is
// installed there, which is flagged below rather than hidden.
const LANGUAGES = [
  { value: "eng", label: "English" },
  { value: "hin", label: "Hindi" },
  { value: "eng+hin", label: "English + Hindi" },
  { value: "fra", label: "French" },
  { value: "spa", label: "Spanish" },
  { value: "deu", label: "German" },
  { value: "ara", label: "Arabic" },
];

export default function OcrConfigPanel() {
  const { user, permissions } = useAuth();
  const canEdit = hasPermission(user?.role, "manage_team", permissions);

  const [saved, setSaved] = useState<OcrSettings | null>(null);
  const [draft, setDraft] = useState<OcrSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFirmSettings()
      .then((data) => {
        const loaded: OcrSettings = { ...DEFAULTS, ...(data.ocr || {}) };
        setSaved(loaded);
        setDraft(loaded);
      })
      .catch(() => setError("Failed to load OCR configuration."))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await updateFirmSettings("ocr", draft);
      setSaved(draft);
    } catch {
      setError("Failed to save OCR configuration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(saved);

  useRegisterSaveBar(
    canEdit && draft
      ? { isDirty, saving, onSave: handleSave, onDiscard: handleDiscard, label: "Unsaved OCR configuration." }
      : null
  );

  if (loading || !draft) {
    return <p className="text-[#8a7c68]">Loading OCR configuration...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">OCR Configuration</h1>
        <p className="text-sm text-[#8a7c68]">
          Controls text extraction from scanned PDFs and image uploads (JPG/PNG). Engine:
          Tesseract - the only OCR engine this platform actually integrates with today.
        </p>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">Language</h2>
        <div className="flex flex-col gap-1 sm:max-w-xs">
          <label className="text-xs text-[#8a7c68]">OCR language</label>
          {canEdit ? (
            <select
              value={draft.lang}
              onChange={(e) => setDraft((prev) => (prev ? { ...prev, lang: e.target.value } : prev))}
              className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
            >
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-[#e0d2ba]">
              {LANGUAGES.find((l) => l.value === draft.lang)?.label || draft.lang}
            </p>
          )}
        </div>
        {draft.lang !== "eng" && (
          <p className="mt-2 text-xs text-yellow-400">
            Only the English language pack is currently installed on this server. OCR will fail
            until the Tesseract language pack for this language is installed there too.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">Processing</h2>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm text-[#e0d2ba]">Automatically OCR scanned uploads</span>
            <span className="block text-xs text-[#8a7c68]">
              When off, scanned PDFs and image uploads with no extractable text will fail to
              upload instead of being OCR&apos;d.
            </span>
          </span>
          <Toggle
            checked={draft.auto_ocr}
            disabled={!canEdit}
            onChange={(next) => setDraft((prev) => (prev ? { ...prev, auto_ocr: next } : prev))}
          />
        </label>
      </section>

      {!canEdit && (
        <p className="text-xs text-[#5a4f3f]">Only firm admins can change OCR configuration.</p>
      )}
    </div>
  );
}
