"use client";

import { useEffect, useState } from "react";
import { getFirmSettings, updateFirmSettings } from "@/lib/api";
import { useRegisterSaveBar } from "../_lib/SaveBarContext";
import Toggle from "./Toggle";

export type MockFieldValue = string | boolean;

export interface MockField {
  key: string;
  label: string;
  type: "toggle" | "select" | "text";
  options?: { value: string; label: string }[];
  placeholder?: string;
  defaultValue?: MockFieldValue;
}

export interface MockTile {
  id: string;
  title: string;
  description?: string;
  badge?: string;
  fields: MockField[];
  disabled?: boolean;
  disabledReason?: string;
}

type ValueMap = Record<string, MockFieldValue>;

function fieldId(tileId: string, fieldKey: string) {
  return `${tileId}::${fieldKey}`;
}

function defaultsFor(tiles: MockTile[]): ValueMap {
  const defaults: ValueMap = {};
  for (const tile of tiles) {
    for (const field of tile.fields) {
      defaults[fieldId(tile.id, field.key)] =
        field.defaultValue ?? (field.type === "toggle" ? false : "");
    }
  }
  return defaults;
}

export default function MockPanel({
  categoryId,
  title,
  description,
  honestBanner,
  tiles,
}: {
  categoryId: string;
  title: string;
  description: string;
  honestBanner?: string;
  tiles: MockTile[];
}) {
  const [saved, setSaved] = useState<ValueMap | null>(null);
  const [draft, setDraft] = useState<ValueMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getFirmSettings()
      .then((data) => {
        if (cancelled) return;
        const stored = (data.mock?.[categoryId] as ValueMap) || {};
        const merged = { ...defaultsFor(tiles), ...stored };
        setSaved(merged);
        setDraft(merged);
      })
      .catch(() => setError("Failed to load settings."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const isDirty = JSON.stringify(saved) !== JSON.stringify(draft);

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await updateFirmSettings("mock", { [categoryId]: draft });
      setSaved(draft);
    } catch {
      setError("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => setDraft(saved);

  useRegisterSaveBar(
    draft
      ? {
          isDirty,
          saving,
          onSave: handleSave,
          onDiscard: handleDiscard,
          label: `Unsaved changes in ${title}.`,
        }
      : null
  );

  const setField = (tileId: string, fieldKey: string, value: MockFieldValue) => {
    setDraft((prev) => (prev ? { ...prev, [fieldId(tileId, fieldKey)]: value } : prev));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">{title}</h1>
        <p className="text-sm text-[#8a7c68]">{description}</p>
      </div>

      {honestBanner && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {honestBanner}
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      {loading || !draft ? (
        <p className="text-[#8a7c68]">Loading...</p>
      ) : (
        <div className="flex flex-col gap-4">
          {tiles.map((tile) => (
            <section
              key={tile.id}
              className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-[#f0e6cc]">{tile.title}</h2>
                  {tile.description && (
                    <p className="text-xs text-[#8a7c68]">{tile.description}</p>
                  )}
                </div>
                {tile.badge && (
                  <span className="rounded-full bg-[#c9a96e]/10 px-2 py-0.5 text-[10px] text-[#c9a96e]">
                    {tile.badge}
                  </span>
                )}
              </div>

              {tile.disabled && tile.disabledReason && (
                <p className="mb-3 text-xs text-[#5a4f3f]">{tile.disabledReason}</p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {tile.fields.map((field) => {
                  const id = fieldId(tile.id, field.key);
                  const value = draft[id];

                  if (field.type === "toggle") {
                    return (
                      <label
                        key={field.key}
                        className="flex items-center gap-3 rounded-lg border border-[#c9a96e]/10 px-3 py-2"
                      >
                        <Toggle
                          checked={Boolean(value)}
                          disabled={tile.disabled}
                          onChange={(next) => setField(tile.id, field.key, next)}
                        />
                        <span className="text-sm text-[#e0d2ba]">{field.label}</span>
                      </label>
                    );
                  }

                  if (field.type === "select") {
                    return (
                      <div key={field.key} className="flex flex-col gap-1">
                        <label className="text-xs text-[#8a7c68]">{field.label}</label>
                        <select
                          value={String(value)}
                          disabled={tile.disabled}
                          onChange={(event) => setField(tile.id, field.key, event.target.value)}
                          className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba] disabled:opacity-40"
                        >
                          {(field.options || []).map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  }

                  return (
                    <div key={field.key} className="flex flex-1 flex-col gap-1">
                      <label className="text-xs text-[#8a7c68]">{field.label}</label>
                      <input
                        value={String(value)}
                        disabled={tile.disabled}
                        placeholder={field.placeholder}
                        onChange={(event) => setField(tile.id, field.key, event.target.value)}
                        className="min-w-[220px] rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50 disabled:opacity-40"
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
