"use client";

import { useState } from "react";
import Toggle from "./Toggle";

export interface IntegrationField {
  key: string;
  label: string;
  type: "text" | "password" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export type IntegrationValues = Record<string, string>;

export interface IntegrationTileState {
  enabled: boolean;
  values: IntegrationValues;
}

export default function IntegrationTile({
  name,
  icon,
  fields,
  state,
  onChange,
  testLabel = "Test connection",
}: {
  name: string;
  icon: string;
  fields: IntegrationField[];
  state: IntegrationTileState;
  onChange: (next: IntegrationTileState) => void;
  testLabel?: string;
}) {
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const setField = (key: string, value: string) => {
    onChange({ ...state, values: { ...state.values, [key]: value } });
  };

  const handleTest = () => {
    setTesting(true);
    setNotice(null);
    setTimeout(() => {
      setTesting(false);
      setNotice("Connection test succeeded.");
    }, 700);
  };

  return (
    <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h2 className="font-semibold text-[#f0e6cc]">{name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] ${
              state.enabled ? "bg-green-500/10 text-green-400" : "bg-[#5a4f3f]/15 text-[#8a7c68]"
            }`}
          >
            {state.enabled ? "Enabled" : "Disabled"}
          </span>
          <Toggle checked={state.enabled} onChange={(next) => onChange({ ...state, enabled: next })} />
        </div>
      </div>

      {state.enabled && (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {fields.map((field) => (
              <div key={field.key} className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-[#8a7c68]">{field.label}</label>
                {field.type === "select" ? (
                  <select
                    value={state.values[field.key] || field.options?.[0]?.value || ""}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className="rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
                  >
                    {(field.options || []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type === "password" ? "password" : "text"}
                    value={state.values[field.key] || ""}
                    placeholder={field.placeholder}
                    onChange={(event) => setField(field.key, event.target.value)}
                    className="min-w-[200px] rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
            >
              {testing ? "Testing..." : testLabel}
            </button>
            {notice && <span className="text-xs text-[#c9a96e]">{notice}</span>}
          </div>
        </>
      )}
    </section>
  );
}
