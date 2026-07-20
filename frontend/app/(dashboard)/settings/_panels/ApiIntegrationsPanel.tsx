"use client";

import { useEffect, useState } from "react";
import {
  deleteApiIntegration,
  listApiIntegrations,
  saveApiIntegration,
  testApiIntegration,
  updateApiIntegration,
  type AIProviderId,
  type APIIntegration,
} from "@/lib/api";
import { useAiMode } from "../_lib/AiModeContext";

const CUSTOM_MODEL = "__custom__";

const PROVIDERS: {
  id: AIProviderId;
  name: string;
  icon: string;
  modelPlaceholder: string;
  models?: string[];
  needsBaseUrl?: boolean;
  baseUrlLabel?: string;
}[] = [
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    modelPlaceholder: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "mixtral-8x7b-32768"],
  },
  {
    id: "openai",
    name: "OpenAI",
    icon: "🟢",
    modelPlaceholder: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4-turbo", "o3-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "🟣",
    modelPlaceholder: "claude-sonnet-4-5",
    models: ["claude-sonnet-4-5", "claude-opus-4-8", "claude-haiku-4-5", "claude-3-5-sonnet-20241022"],
  },
  {
    id: "gemini",
    name: "Google Gemini",
    icon: "🔵",
    modelPlaceholder: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    icon: "🔷",
    modelPlaceholder: "your-deployment-name",
    needsBaseUrl: true,
    baseUrlLabel: "Resource endpoint",
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: "🌬️",
    modelPlaceholder: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
  },
];

interface TileDraft {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelMode: "list" | "custom";
}

function emptyDraft(): TileDraft {
  return { apiKey: "", baseUrl: "", model: "", modelMode: "list" };
}

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-green-500/10 text-green-400",
  failed: "bg-red-500/10 text-red-300",
  untested: "bg-[#5a4f3f]/15 text-[#8a7c68]",
};

export default function ApiIntegrationsPanel() {
  const { refresh: refreshAiMode } = useAiMode();

  const [integrations, setIntegrations] = useState<Record<AIProviderId, APIIntegration>>(
    {} as Record<AIProviderId, APIIntegration>
  );
  const [drafts, setDrafts] = useState<Record<AIProviderId, TileDraft>>(() =>
    Object.fromEntries(PROVIDERS.map((p) => [p.id, emptyDraft()])) as Record<AIProviderId, TileDraft>
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    listApiIntegrations()
      .then((data) => {
        const byProvider = Object.fromEntries(data.map((item) => [item.provider, item])) as Record<
          AIProviderId,
          APIIntegration
        >;
        setIntegrations(byProvider);
      })
      .catch(() => setError("Failed to load API integrations."))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const setDraft = (id: AIProviderId, patch: Partial<TileDraft>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleSave = async (id: AIProviderId) => {
    const draft = drafts[id];
    if (!draft.apiKey.trim()) {
      setError("API key is required.");
      return;
    }

    setBusy(`${id}:save`);
    setError(null);
    setNotice(null);
    try {
      const result = await saveApiIntegration({
        provider: id,
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model: draft.model.trim(),
      });
      setIntegrations((prev) => ({ ...prev, [id]: result }));
      setDraft(id, { apiKey: "" });
      setNotice(`Saved credentials for ${PROVIDERS.find((p) => p.id === id)?.name}. Test the connection before enabling it.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save credentials.");
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (id: AIProviderId) => {
    setBusy(`${id}:test`);
    setError(null);
    setNotice(null);
    try {
      const result = await testApiIntegration(id);
      setIntegrations((prev) => ({ ...prev, [id]: result }));
      setNotice(result.last_test_message || (result.status === "connected" ? "Connection test succeeded." : "Connection test failed."));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to test connection.");
    } finally {
      setBusy(null);
    }
  };

  const handleEnable = async (id: AIProviderId) => {
    setBusy(`${id}:enable`);
    setError(null);
    setNotice(null);
    try {
      const result = await updateApiIntegration(id, { enabled: true });
      setIntegrations((prev) => {
        const next = { ...prev };
        for (const provider of PROVIDERS) {
          if (next[provider.id]) next[provider.id] = { ...next[provider.id], enabled: provider.id === id };
        }
        next[id] = result;
        return next;
      });
      setNotice(`${PROVIDERS.find((p) => p.id === id)?.name} is now the active provider.`);
      refreshAiMode();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to enable provider.");
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async (id: AIProviderId) => {
    setBusy(`${id}:disable`);
    setError(null);
    setNotice(null);
    try {
      const result = await updateApiIntegration(id, { enabled: false });
      setIntegrations((prev) => ({ ...prev, [id]: result }));
      refreshAiMode();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to disable provider.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: AIProviderId) => {
    if (!confirm(`Delete the stored credential for ${PROVIDERS.find((p) => p.id === id)?.name}?`)) return;

    setBusy(`${id}:delete`);
    setError(null);
    setNotice(null);
    try {
      await deleteApiIntegration(id);
      setIntegrations((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setDraft(id, emptyDraft());
      refreshAiMode();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to delete credential.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">API Integrations</h1>
        <p className="text-sm text-[#8a7c68]">
          Connect your own AI provider credentials for Customer Managed mode. Only one
          provider can be enabled at a time - enabling one automatically disables any other.
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

      {loading ? (
        <p className="text-[#8a7c68]">Loading integrations...</p>
      ) : (
        <div className="flex flex-col gap-4">
          {PROVIDERS.map((provider) => {
            const saved = integrations[provider.id];
            const draft = drafts[provider.id];
            const status = saved?.status ?? "untested";

            return (
              <section
                key={provider.id}
                className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{provider.icon}</span>
                    <h2 className="font-semibold text-[#f0e6cc]">{provider.name}</h2>
                    {saved?.enabled && (
                      <span className="rounded-full bg-[#c9a96e]/15 px-2 py-0.5 text-[10px] text-[#c9a96e]">
                        Active provider
                      </span>
                    )}
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_STYLE[status]}`}>
                    {status === "connected" ? "Connected" : status === "failed" ? "Connection failed" : "Untested"}
                  </span>
                </div>

                {saved?.configured && (
                  <p className="mb-3 text-xs text-[#5a4f3f]">
                    Current key: {saved.key_hint || "****"}
                    {saved.model && ` · Model: ${saved.model}`}
                  </p>
                )}

                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs text-[#8a7c68]">
                      {saved?.configured ? "Replace API key" : "API key"}
                    </label>
                    <input
                      type="password"
                      value={draft.apiKey}
                      onChange={(e) => setDraft(provider.id, { apiKey: e.target.value })}
                      placeholder="sk-..."
                      className="min-w-45 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-xs text-[#8a7c68]">Model {provider.needsBaseUrl && "/ deployment"}</label>
                    {provider.models && draft.modelMode === "list" ? (
                      <select
                        value={draft.model || provider.models[0]}
                        onChange={(e) => {
                          if (e.target.value === CUSTOM_MODEL) {
                            setDraft(provider.id, { modelMode: "custom", model: "" });
                          } else {
                            setDraft(provider.id, { model: e.target.value });
                          }
                        }}
                        className="min-w-45 rounded-lg border border-[#c9a96e]/15 bg-[#0f0c08] px-3 py-2 text-sm text-[#e0d2ba]"
                      >
                        {provider.models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                        <option value={CUSTOM_MODEL}>Custom...</option>
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <input
                          value={draft.model}
                          onChange={(e) => setDraft(provider.id, { model: e.target.value })}
                          placeholder={provider.modelPlaceholder}
                          className="min-w-45 flex-1 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                        />
                        {provider.models && (
                          <button
                            type="button"
                            onClick={() => setDraft(provider.id, { modelMode: "list", model: "" })}
                            className="text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                          >
                            Choose from list
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {provider.needsBaseUrl && (
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-xs text-[#8a7c68]">{provider.baseUrlLabel}</label>
                      <input
                        value={draft.baseUrl}
                        onChange={(e) => setDraft(provider.id, { baseUrl: e.target.value })}
                        placeholder="https://your-resource.openai.azure.com"
                        className="min-w-45 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                      />
                    </div>
                  )}
                  <div className="flex items-end">
                    <button
                      onClick={() => handleSave(provider.id)}
                      disabled={busy === `${provider.id}:save`}
                      className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
                    >
                      {busy === `${provider.id}:save` ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                {saved?.configured && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTest(provider.id)}
                      disabled={busy === `${provider.id}:test`}
                      className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                    >
                      {busy === `${provider.id}:test` ? "Testing..." : "Test connection"}
                    </button>
                    {saved.enabled ? (
                      <button
                        onClick={() => handleDisable(provider.id)}
                        disabled={busy === `${provider.id}:disable`}
                        className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                      >
                        {busy === `${provider.id}:disable` ? "Disabling..." : "Disable"}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleEnable(provider.id)}
                        disabled={saved.status !== "connected" || busy === `${provider.id}:enable`}
                        title={saved.status !== "connected" ? "Test the connection successfully first" : ""}
                        className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#c9a96e] disabled:opacity-40"
                      >
                        {busy === `${provider.id}:enable` ? "Enabling..." : "Enable"}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(provider.id)}
                      disabled={busy === `${provider.id}:delete`}
                      className="rounded-lg border border-red-500/30 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                    >
                      {busy === `${provider.id}:delete` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
