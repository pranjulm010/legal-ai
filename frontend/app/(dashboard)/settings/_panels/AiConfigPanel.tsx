"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { updateAiProviderMode, type AIProviderMode } from "@/lib/api";
import { useAiMode } from "../_lib/AiModeContext";

const PLATFORM_MODELS = [
  { name: "Groq Llama 3.3 70B", role: "General chat and legal research answers" },
  { name: "Groq GPT-OSS 120B", role: "Tool-calling agent (document search, case lookup, drafting)" },
];

export default function AiConfigPanel() {
  const { user } = useAuth();
  const canEdit = user?.role === "admin";
  const { mode, hasConnectedCredential, loading, setMode } = useAiMode();

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNotice(null);
    setError(null);
  }, [mode]);

  const handleSelect = async (next: AIProviderMode) => {
    if (next === mode || saving) return;

    const confirmed = window.confirm(
      next === "CUSTOMER"
        ? "Switch to Customer Managed mode? All future AI requests for this workspace " +
            "would use your connected provider's API key instead of Legal AI's platform key."
        : "Switch to Platform Managed mode? All future AI requests would go back to using " +
            "Legal AI's platform key."
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const status = await updateAiProviderMode(next);
      setMode(status.provider_mode, status.has_connected_credential);
      setNotice(
        status.provider_mode === "CUSTOMER"
          ? "AI Provider Mode set to Customer Managed."
          : "AI Provider Mode set to Platform Managed."
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.error || "Failed to change AI Provider Mode. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">AI Configuration</h1>
        <p className="text-sm text-[#8a7c68]">
          Choose whether this workspace's AI requests run on Legal AI's platform key or your own
          connected provider. A workspace uses exactly one mode at a time - never both.
        </p>
      </div>

      {notice && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-red-500/25 bg-red-500/5 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">AI Provider Mode</h2>

        <div className="flex flex-col gap-3">
          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              mode === "PLATFORM" ? "border-[#c9a96e]/40 bg-[#c9a96e]/5" : "border-[#c9a96e]/10"
            } ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}
          >
            <input
              type="radio"
              name="ai-provider-mode"
              checked={mode === "PLATFORM"}
              disabled={!canEdit || saving || loading}
              onChange={() => handleSelect("PLATFORM")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-[#e0d2ba]">Platform Managed</span>
              <span className="block text-xs text-[#8a7c68]">
                Default. All AI requests use Legal AI&apos;s own managed API keys - no setup
                required. Usage is covered by your Legal AI subscription.
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              mode === "CUSTOMER" ? "border-[#c9a96e]/40 bg-[#c9a96e]/5" : "border-[#c9a96e]/10"
            } ${canEdit ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}
          >
            <input
              type="radio"
              name="ai-provider-mode"
              checked={mode === "CUSTOMER"}
              disabled={!canEdit || saving || loading}
              onChange={() => handleSelect("CUSTOMER")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-[#e0d2ba]">Customer Managed</span>
              <span className="block text-xs text-[#8a7c68]">
                All AI requests use your own connected provider&apos;s API key instead. Manage the
                credential in API Integrations; you&apos;re billed directly by that provider.
              </span>
            </span>
          </label>
        </div>

        {!canEdit && (
          <p className="mt-3 text-xs text-[#5a4f3f]">Only workspace admins can change this setting.</p>
        )}
        {canEdit && mode === "PLATFORM" && !hasConnectedCredential && (
          <p className="mt-3 text-xs text-[#5a4f3f]">
            Connect and test a provider in API Integrations before switching to Customer Managed.
          </p>
        )}
      </section>

      {mode === "PLATFORM" ? (
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Available Platform Models</h2>
          <p className="mb-3 text-xs text-[#5a4f3f]">
            These are the models actually powering your requests right now under Legal AI&apos;s
            platform subscription.
          </p>
          <ul className="flex flex-col gap-2">
            {PLATFORM_MODELS.map((model) => (
              <li
                key={model.name}
                className="flex items-center justify-between rounded-lg border border-[#c9a96e]/10 px-3 py-2 text-sm"
              >
                <span className="text-[#e0d2ba]">{model.name}</span>
                <span className="text-xs text-[#8a7c68]">{model.role}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-2 font-semibold text-[#f0e6cc]">Connected Provider</h2>
          <p className="text-xs text-[#8a7c68]">
            Manage which provider is connected, test its connection, and enable/disable it from
            the API Integrations tab in the left sidebar.
          </p>
        </section>
      )}
    </div>
  );
}
