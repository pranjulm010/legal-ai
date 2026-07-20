"use client";

import { useEffect, useState } from "react";
import {
  disableAiProvider,
  deleteAiProviderCredential,
  enableAiProvider,
  listAiProviders,
  saveAiProviderCredential,
  testAiProviderConnection,
  type AiProviderId,
  type AiProviderSummary,
} from "@/lib/api";
import { useAiModeContext } from "../_lib/AiModeContext";

const CUSTOM_MODEL = "__custom__";

const PROVIDERS: {
  id: AiProviderId;
  name: string;
  icon: string;
  modelPlaceholder: string;
  // Curated list of common models for this provider family, shown as a
  // dropdown so most users never have to type a model id by hand. Always
  // paired with a "Custom..." option that reveals a free-text field, since
  // provider catalogs change faster than this list can be kept current.
  models?: string[];
  needsBaseUrl?: boolean;
  baseUrlLabel?: string;
  needsApiVersion?: boolean;
}[] = [
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    modelPlaceholder: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "mixtral-8x7b-32768", "gemma2-9b-it"],
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
    id: "google_gemini",
    name: "Google Gemini",
    icon: "🔵",
    modelPlaceholder: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-2.0-pro", "gemini-1.5-pro", "gemini-1.5-flash"],
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    icon: "🔷",
    // Azure has no fixed model catalog to pick from - "model" here is the
    // customer's own deployment name, always free text.
    modelPlaceholder: "your-deployment-name",
    needsBaseUrl: true,
    baseUrlLabel: "Resource endpoint",
    needsApiVersion: true,
  },
  {
    id: "mistral",
    name: "Mistral",
    icon: "🌬️",
    modelPlaceholder: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "open-mixtral-8x22b"],
  },
];

const STATUS_STYLE: Record<string, string> = {
  connected: "bg-green-500/10 text-green-400",
  failed: "bg-red-500/10 text-red-300",
  untested: "bg-[#5a4f3f]/15 text-[#8a7c68]",
};

interface DraftState {
  apiKey: string;
  baseUrl: string;
  model: string;
  modelMode: "list" | "custom";
  apiVersion: string;
  editing: boolean;
}

function emptyDraft(summary: AiProviderSummary | undefined, modelOptions: string[] | undefined): DraftState {
  const model = summary?.model || "";
  // If the saved model isn't one of the curated options (or this provider
  // has no curated list at all, e.g. Azure's deployment name), default to
  // the free-text "custom" field so an existing value is never hidden.
  const modelMode: "list" | "custom" =
    modelOptions && (model === "" || modelOptions.includes(model)) ? "list" : "custom";
  return {
    apiKey: "",
    baseUrl: summary?.base_url || "",
    model,
    modelMode,
    apiVersion: "2024-10-21",
    editing: !summary?.configured,
  };
}

export default function ApiIntegrationsPanel() {
  const { mode: aiMode } = useAiModeContext();
  const [summaries, setSummaries] = useState<Record<AiProviderId, AiProviderSummary> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => {
    listAiProviders()
      .then((list) => {
        const byId = Object.fromEntries(list.map((s) => [s.provider, s])) as Record<
          AiProviderId,
          AiProviderSummary
        >;
        setSummaries(byId);
        setDrafts((prev) => {
          const next = { ...prev };
          for (const provider of PROVIDERS) {
            if (!next[provider.id]) next[provider.id] = emptyDraft(byId[provider.id], provider.models);
          }
          return next;
        });
      })
      .catch(() => setError("Failed to load AI providers."));
  };

  useEffect(() => {
    load();
  }, []);

  const setDraft = (id: AiProviderId, patch: Partial<DraftState>) => {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleSave = async (id: AiProviderId) => {
    const draft = drafts[id];
    if (!draft?.apiKey.trim()) {
      setError("API key is required.");
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(`${id}:save`);
    try {
      const extra_config =
        PROVIDERS.find((p) => p.id === id)?.needsApiVersion && draft.apiVersion
          ? { api_version: draft.apiVersion }
          : {};
      await saveAiProviderCredential(id, {
        api_key: draft.apiKey.trim(),
        base_url: draft.baseUrl.trim(),
        model: draft.model.trim(),
        extra_config,
      });
      setDraft(id, { apiKey: "", editing: false });
      setNotice(`Saved credentials for ${id}. Test the connection before enabling it.`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save credential.");
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async (id: AiProviderId) => {
    setError(null);
    setNotice(null);
    setBusy(`${id}:test`);
    try {
      const summary = await testAiProviderConnection(id);
      setSummaries((prev) => (prev ? { ...prev, [id]: summary } : prev));
      setNotice(summary.last_test_message);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to test connection.");
    } finally {
      setBusy(null);
    }
  };

  const handleEnable = async (id: AiProviderId) => {
    setError(null);
    setNotice(null);
    setBusy(`${id}:enable`);
    try {
      await enableAiProvider(id);
      setNotice(`${id} is now the active provider.`);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to enable provider.");
    } finally {
      setBusy(null);
    }
  };

  const handleDisable = async (id: AiProviderId) => {
    setError(null);
    setNotice(null);
    setBusy(`${id}:disable`);
    try {
      await disableAiProvider(id);
      load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to disable provider.");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: AiProviderId) => {
    if (!confirm(`Delete the stored credential for ${id}? This cannot be undone.`)) return;
    setError(null);
    setNotice(null);
    setBusy(`${id}:delete`);
    try {
      await deleteAiProviderCredential(id);
      setDraft(id, emptyDraft(undefined, PROVIDERS.find((p) => p.id === id)?.models));
      load();
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
          Connect your own AI provider credentials for Customer Managed (BYOK) mode. Only one
          provider can be enabled at a time - enabling one automatically disables any other.
        </p>
      </div>

      {aiMode === "platform_managed" && (
        <div className="rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-xs text-[#c9a96e]">
          This workspace is currently in Platform Managed mode - any credentials saved here stay
          securely stored but aren&apos;t used for AI requests until you switch to Customer Managed
          mode in AI Configuration.
        </div>
      )}

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

      {!summaries ? (
        <p className="text-[#8a7c68]">Loading providers...</p>
      ) : (
        <div className="flex flex-col gap-4">
          {PROVIDERS.map((provider) => {
            const summary = summaries[provider.id];
            const draft = drafts[provider.id] || emptyDraft(summary, provider.models);

            return (
              <section
                key={provider.id}
                className="rounded-xl border border-[#c9a96e]/12 bg-[#0f0c08] p-5"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{provider.icon}</span>
                    <h2 className="font-semibold text-[#f0e6cc]">{provider.name}</h2>
                    {summary?.enabled && (
                      <span className="rounded-full bg-[#c9a96e]/15 px-2 py-0.5 text-[10px] text-[#c9a96e]">
                        Active provider
                      </span>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] ${STATUS_STYLE[summary?.status || "untested"]}`}
                  >
                    {summary?.status === "connected"
                      ? "Connected"
                      : summary?.status === "failed"
                      ? "Connection failed"
                      : "Untested"}
                  </span>
                </div>

                {summary?.configured && !draft.editing ? (
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="text-[#8a7c68]">
                      Key: <span className="text-[#e0d2ba]">{summary.key_hint || "••••"}</span>
                    </span>
                    {summary.model && (
                      <span className="text-[#8a7c68]">
                        Model: <span className="text-[#e0d2ba]">{summary.model}</span>
                      </span>
                    )}
                    {summary.last_tested_at && (
                      <span className="text-xs text-[#5a4f3f]">
                        Last tested {new Date(summary.last_tested_at).toLocaleString()}
                        {summary.last_test_message ? ` - ${summary.last_test_message}` : ""}
                      </span>
                    )}
                    <button
                      onClick={() => setDraft(provider.id, { editing: true })}
                      className="text-xs text-[#8a7c68] hover:text-[#c9a96e]"
                    >
                      Update key
                    </button>
                  </div>
                ) : (
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <div className="flex flex-1 flex-col gap-1">
                      <label className="text-xs text-[#8a7c68]">API key</label>
                      <input
                        type="password"
                        value={draft.apiKey}
                        onChange={(e) => setDraft(provider.id, { apiKey: e.target.value })}
                        placeholder={summary?.configured ? "Enter a new key to replace the saved one" : "sk-..."}
                        className="min-w-[220px] rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
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
                          className="min-w-[220px] rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                        />
                      </div>
                    )}
                    {provider.needsApiVersion && (
                      <div className="flex flex-col gap-1">
                        <label className="text-xs text-[#8a7c68]">API version</label>
                        <input
                          value={draft.apiVersion}
                          onChange={(e) => setDraft(provider.id, { apiVersion: e.target.value })}
                          className="w-32 rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
                        />
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <button
                        onClick={() => handleSave(provider.id)}
                        disabled={busy === `${provider.id}:save`}
                        className="rounded-lg bg-[#c9a96e] px-4 py-2 text-sm font-semibold text-[#1a0e00] disabled:opacity-50"
                      >
                        {busy === `${provider.id}:save` ? "Saving..." : "Save"}
                      </button>
                      {summary?.configured && (
                        <button
                          onClick={() => setDraft(provider.id, { apiKey: "", editing: false })}
                          className="rounded-lg border border-[#c9a96e]/15 px-3 py-2 text-xs text-[#8a7c68]"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {summary?.configured && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleTest(provider.id)}
                      disabled={busy === `${provider.id}:test`}
                      className="rounded-lg border border-[#c9a96e]/15 px-3 py-1 text-xs text-[#8a7c68] hover:text-[#c9a96e] disabled:opacity-50"
                    >
                      {busy === `${provider.id}:test` ? "Testing..." : "Test connection"}
                    </button>
                    {summary.enabled ? (
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
                        disabled={busy === `${provider.id}:enable` || summary.status !== "connected"}
                        title={summary.status !== "connected" ? "Test the connection successfully first" : ""}
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
