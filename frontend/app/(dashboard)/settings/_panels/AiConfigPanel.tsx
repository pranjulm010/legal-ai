"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import {
  getAiProviderMode,
  updateAiProviderMode,
  type AiProviderMode,
  type AiProviderModeValue,
} from "@/lib/api";
import { useAiModeContext } from "../_lib/AiModeContext";

const PLATFORM_MODELS = [
  { name: "Groq Llama 3.3 70B", role: "General chat and legal research answers" },
  { name: "Groq GPT-OSS 120B", role: "Tool-calling agent (document search, case lookup, drafting)" },
];

export default function AiConfigPanel() {
  const { user, permissions } = useAuth();
  const canEdit = hasPermission(user?.role, "manage_team", permissions);
  const { refresh: refreshShellAiMode } = useAiModeContext();

  const [state, setState] = useState<AiProviderMode | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    getAiProviderMode()
      .then(setState)
      .catch(() => setError("Failed to load AI Provider Mode."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSelect = async (mode: AiProviderModeValue) => {
    if (!state || mode === state.mode) return;
    setError(null);
    setNotice(null);

    if (mode === "customer_managed" && !state.has_connected_credential) {
      setError(
        "No connected AI provider yet. Go to the API Integrations tab, save and test a provider's " +
          "API key, then enable it before switching to Customer Managed mode."
      );
      return;
    }

    const confirmed = window.confirm(
      mode === "customer_managed"
        ? "Switch to Customer Managed (BYOK) mode? All future AI requests for this workspace will use " +
            "your connected provider's API key instead of Legal AI's platform key. This takes effect immediately."
        : "Switch to Platform Managed mode? All future AI requests will go back to using Legal AI's " +
            "platform key. Your saved provider credentials stay stored but won't be used unless you " +
            "switch back to Customer Managed mode."
    );
    if (!confirmed) return;

    setSwitching(true);
    try {
      const updated = await updateAiProviderMode(mode);
      setState(updated);
      refreshShellAiMode();
      setNotice(
        mode === "customer_managed"
          ? "Now routing AI requests through your connected provider."
          : "Now routing AI requests through Legal AI's platform key."
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to switch AI Provider Mode.");
    } finally {
      setSwitching(false);
    }
  };

  if (loading || !state) {
    return <p className="text-[#8a7c68]">Loading AI configuration...</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">AI Configuration</h1>
        <p className="text-sm text-[#8a7c68]">
          Choose whether this workspace's AI requests run on Legal AI's platform key or your own
          connected provider. A workspace uses exactly one mode at a time - never both.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-sm text-[#c9a96e]">
          {notice}
        </div>
      )}

      <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
        <h2 className="mb-3 font-semibold text-[#f0e6cc]">AI Provider Mode</h2>

        <div className="flex flex-col gap-3">
          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              state.mode === "platform_managed" ? "border-[#c9a96e]/40 bg-[#c9a96e]/5" : "border-[#c9a96e]/10"
            } ${canEdit && !switching ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}
          >
            <input
              type="radio"
              name="ai-provider-mode"
              checked={state.mode === "platform_managed"}
              disabled={!canEdit || switching}
              onChange={() => handleSelect("platform_managed")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-[#e0d2ba]">Platform Managed (SaaS)</span>
              <span className="block text-xs text-[#8a7c68]">
                Default. All AI requests use Legal AI's own managed API keys - no setup required.
                Usage is covered by your Legal AI subscription.
              </span>
            </span>
          </label>

          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
              state.mode === "customer_managed" ? "border-[#c9a96e]/40 bg-[#c9a96e]/5" : "border-[#c9a96e]/10"
            } ${canEdit && !switching ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}
          >
            <input
              type="radio"
              name="ai-provider-mode"
              checked={state.mode === "customer_managed"}
              disabled={!canEdit || switching}
              onChange={() => handleSelect("customer_managed")}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-[#e0d2ba]">
                Customer Managed (Bring Your Own API Key - BYOK)
              </span>
              <span className="block text-xs text-[#8a7c68]">
                All AI requests use your own connected provider's API key instead. You manage the
                credential in API Integrations, and you're billed directly by that provider for usage.
              </span>
            </span>
          </label>
        </div>

        {!canEdit && (
          <p className="mt-3 text-xs text-[#5a4f3f]">Only workspace admins can change this setting.</p>
        )}
      </section>

      {state.mode === "platform_managed" ? (
        <section className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5">
          <h2 className="mb-3 font-semibold text-[#f0e6cc]">Available Platform Models</h2>
          <p className="mb-3 text-xs text-[#5a4f3f]">
            These are the models actually powering your requests right now under Legal AI's platform
            subscription.
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
            Manage which provider is connected, test its connection, and enable/disable it from the
            API Integrations tab in the left sidebar.
          </p>
        </section>
      )}
    </div>
  );
}
