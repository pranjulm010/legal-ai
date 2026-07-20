"use client";

import { useSaveBarState } from "../_lib/SaveBarContext";

export default function SaveBar() {
  const state = useSaveBarState();

  if (!state || !state.isDirty) return null;

  return (
    <div className="sticky bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-4 border-t border-[#c9a96e]/20 bg-[#0f0c08]/95 px-5 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.4)] backdrop-blur">
      <p className="text-sm text-[#e0d2ba]">
        {state.label || "You have unsaved changes."}
      </p>
      <div className="flex gap-2">
        <button
          onClick={state.onDiscard}
          disabled={state.saving}
          className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
        >
          Discard
        </button>
        <button
          onClick={state.onSave}
          disabled={state.saving}
          className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
        >
          {state.saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </div>
  );
}
