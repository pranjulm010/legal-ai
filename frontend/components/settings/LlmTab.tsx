"use client";

import { useEffect, useState } from "react";
import {
  activateLlmProvider,
  deleteLlmKey,
  getLlmConfig,
  saveLlmKey,
  restoreLlmPlatformDefault,
  validateLlmKey,
  type LlmConfigItem,
  type LlmConfigStatus,
  type LlmProvider,
} from "@/lib/api";
import {
  Badge,
  ErrorNotice,
  Field,
  Notice,
  SettingsCard,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  dangerButtonClass,
} from "./ui";

const PROVIDERS: { id: LlmProvider; label: string; keyPlaceholder: string; modelPlaceholder: string }[] = [
  { id: "groq", label: "Groq", keyPlaceholder: "gsk_...", modelPlaceholder: "llama-3.3-70b-versatile" },
  { id: "openai", label: "OpenAI", keyPlaceholder: "sk-...", modelPlaceholder: "gpt-4o" },
  { id: "anthropic", label: "Anthropic", keyPlaceholder: "sk-ant-...", modelPlaceholder: "claude-sonnet-5" },
  { id: "gemini", label: "Google Gemini", keyPlaceholder: "AIza...", modelPlaceholder: "gemini-2.0-flash" },
];

export default function LlmTab({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<LlmConfigStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-provider form state, keyed by provider id.
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [modelInputs, setModelInputs] = useState<Record<string, string>>({});
  const [showKeyForm, setShowKeyForm] = useState<Record<string, boolean>>({});
  const [validating, setValidating] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<
    Record<string, { valid: boolean; error: string | null }>
  >({});
  const [saving, setSaving] = useState<string | null>(null);
  const [activating, setActivating] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [switchingToDefault, setSwitchingToDefault] = useState(false);

  useEffect(() => {
    getLlmConfig()
      .then(setStatus)
      .catch(() => setLoadError("Failed to load LLM configuration."));
  }, []);

  const applyStatus = (next: LlmConfigStatus, message?: string) => {
    setStatus(next);
    setError(null);
    if (message) setNotice(message);
  };

  const configFor = (provider: LlmProvider): LlmConfigItem | undefined =>
    status?.configs.find((config) => config.provider === provider);

  const handleValidate = async (provider: LlmProvider) => {
    const apiKey = (keyInputs[provider] || "").trim();
    if (!apiKey) return;

    setValidating(provider);
    setError(null);
    setValidationResult((prev) => ({ ...prev, [provider]: undefined as never }));

    try {
      const result = await validateLlmKey(provider, apiKey);
      setValidationResult((prev) => ({ ...prev, [provider]: result }));
    } catch (err: any) {
      setError(err?.response?.data?.error || "Validation request failed.");
    } finally {
      setValidating(null);
    }
  };

  const handleSave = async (provider: LlmProvider) => {
    const apiKey = (keyInputs[provider] || "").trim();
    if (!apiKey) return;

    setSaving(provider);
    setError(null);
    setNotice(null);

    try {
      const next = await saveLlmKey(provider, apiKey, (modelInputs[provider] || "").trim());
      // The key never comes back from the server - clear it from local state
      // as soon as it's stored.
      setKeyInputs((prev) => ({ ...prev, [provider]: "" }));
      setShowKeyForm((prev) => ({ ...prev, [provider]: false }));
      setValidationResult((prev) => ({ ...prev, [provider]: undefined as never }));
      applyStatus(next, `${PROVIDERS.find((p) => p.id === provider)?.label} API key validated and saved.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to save the API key.");
    } finally {
      setSaving(null);
    }
  };

  const handleActivate = async (provider: LlmProvider) => {
    setActivating(provider);
    setError(null);
    setNotice(null);

    try {
      const next = await activateLlmProvider(provider);
      applyStatus(
        next,
        `Your firm now uses its own ${PROVIDERS.find((p) => p.id === provider)?.label} configuration.`
      );
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to activate this provider.");
    } finally {
      setActivating(null);
    }
  };

  const handleUseDefault = async () => {
    setSwitchingToDefault(true);
    setError(null);
    setNotice(null);

    try {
      const next = await restoreLlmPlatformDefault();
      applyStatus(next, "Switched back to the platform's default model.");
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to switch to the platform default.");
    } finally {
      setSwitchingToDefault(false);
    }
  };

  const handleRemove = async (provider: LlmProvider) => {
    const label = PROVIDERS.find((p) => p.id === provider)?.label;
    if (!confirm(`Remove the saved ${label} API key? ${configFor(provider)?.is_active ? "Your firm will switch back to the platform default model." : ""}`)) {
      return;
    }

    setRemoving(provider);
    setError(null);
    setNotice(null);

    try {
      const next = await deleteLlmKey(provider);
      applyStatus(next, `${label} API key removed.`);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to remove the API key.");
    } finally {
      setRemoving(null);
    }
  };

  if (loadError) return <ErrorNotice>{loadError}</ErrorNotice>;
  if (!status) return <p className="text-sm text-[#8a7c68]">Loading LLM configuration...</p>;

  return (
    <div className="flex flex-col gap-6">
      {notice && <Notice>{notice}</Notice>}
      {error && <ErrorNotice>{error}</ErrorNotice>}

      {!isAdmin && (
        <p className="text-xs text-[#5a4f3f]">
          Only firm admins can change the LLM configuration. You can view it below.
        </p>
      )}

      {/* Active configuration summary */}
      <SettingsCard
        title="Active configuration"
        subtitle="The model every AI feature (chat, drafting, document analysis) runs on."
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#c9a96e]/12 px-4 py-3">
          <div>
            {status.using_platform_default ? (
              <>
                <p className="text-sm text-[#e0d2ba]">
                  Platform default{" "}
                  <span className="text-xs text-[#5a4f3f]">
                    ({status.platform_provider} · {status.platform_model})
                  </span>
                </p>
                <p className="text-xs text-[#5a4f3f]">
                  Managed by the platform - no setup needed.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-[#e0d2ba]">
                  Your firm&apos;s own{" "}
                  {status.configs.find((c) => c.is_active)?.provider_label} key{" "}
                  <span className="text-xs text-[#5a4f3f]">
                    ({status.configs.find((c) => c.is_active)?.model_name || "provider default model"}
                    {" · "}
                    {status.configs.find((c) => c.is_active)?.masked_key})
                  </span>
                </p>
                <p className="text-xs text-[#5a4f3f]">
                  All AI requests are billed to your firm&apos;s own API account.
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={status.using_platform_default ? "gold" : "green"}>
              {status.using_platform_default ? "Platform default" : "Custom key active"}
            </Badge>
            {isAdmin && !status.using_platform_default && (
              <button
                onClick={handleUseDefault}
                disabled={switchingToDefault}
                className={secondaryButtonClass}
              >
                {switchingToDefault ? "Switching..." : "Use platform default"}
              </button>
            )}
          </div>
        </div>
      </SettingsCard>

      {/* Provider cards */}
      <SettingsCard
        title="Your own API keys"
        subtitle="Bring your own key from any supported provider. Keys are validated live before saving and are never shown again once stored."
      >
        <div className="flex flex-col gap-3">
          {PROVIDERS.map((provider) => {
            const config = configFor(provider.id);
            const routable = status.routable_providers.includes(provider.id);
            const formOpen = !!showKeyForm[provider.id];
            const validation = validationResult[provider.id];

            return (
              <div
                key={provider.id}
                className="rounded-lg border border-[#c9a96e]/12 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#e0d2ba]">
                      {provider.label}{" "}
                      {config?.is_active && <Badge tone="green">Active</Badge>}
                      {config && !config.is_active && <Badge tone="gold">Key saved</Badge>}
                      {!routable && (
                        <span className="ml-1">
                          <Badge tone="muted">Routing coming soon</Badge>
                        </span>
                      )}
                    </p>
                    {config ? (
                      <p className="text-xs text-[#5a4f3f]">
                        {config.masked_key}
                        {config.model_name && ` · ${config.model_name}`}
                        {config.last_validated_at &&
                          ` · validated ${new Date(config.last_validated_at).toLocaleString()}`}
                      </p>
                    ) : (
                      <p className="text-xs text-[#5a4f3f]">No key saved.</p>
                    )}
                    {!routable && config && (
                      <p className="text-xs text-[#5a4f3f]">
                        This key is stored and validated - it will become selectable when{" "}
                        {provider.label} routing ships.
                      </p>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex flex-wrap items-center gap-2">
                      {config && !config.is_active && routable && (
                        <button
                          onClick={() => handleActivate(provider.id)}
                          disabled={activating === provider.id}
                          className={primaryButtonClass}
                        >
                          {activating === provider.id ? "Activating..." : "Use this"}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowKeyForm((prev) => ({ ...prev, [provider.id]: !formOpen }));
                          setValidationResult((prev) => ({ ...prev, [provider.id]: undefined as never }));
                          if (config && !formOpen) {
                            setModelInputs((prev) => ({ ...prev, [provider.id]: config.model_name }));
                          }
                        }}
                        className={secondaryButtonClass}
                      >
                        {formOpen ? "Cancel" : config ? "Update key" : "Add key"}
                      </button>
                      {config && (
                        <button
                          onClick={() => handleRemove(provider.id)}
                          disabled={removing === provider.id}
                          className={dangerButtonClass}
                        >
                          {removing === provider.id ? "Removing..." : "Remove"}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {isAdmin && formOpen && (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      handleSave(provider.id);
                    }}
                    className="mt-3 flex flex-col gap-3 border-t border-[#c9a96e]/10 pt-3 sm:flex-row sm:flex-wrap sm:items-end"
                  >
                    <div className="flex min-w-[240px] flex-1 flex-col gap-1">
                      <Field label={`${provider.label} API key`}>
                        <input
                          type="password"
                          value={keyInputs[provider.id] || ""}
                          onChange={(event) => {
                            setKeyInputs((prev) => ({ ...prev, [provider.id]: event.target.value }));
                            setValidationResult((prev) => ({ ...prev, [provider.id]: undefined as never }));
                          }}
                          placeholder={provider.keyPlaceholder}
                          required
                          autoComplete="off"
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <Field label="Model (optional)">
                      <input
                        value={modelInputs[provider.id] || ""}
                        onChange={(event) =>
                          setModelInputs((prev) => ({ ...prev, [provider.id]: event.target.value }))
                        }
                        placeholder={provider.modelPlaceholder}
                        className={inputClass}
                      />
                    </Field>
                    <button
                      type="button"
                      onClick={() => handleValidate(provider.id)}
                      disabled={validating === provider.id || !(keyInputs[provider.id] || "").trim()}
                      className="rounded-lg border border-[#c9a96e]/15 px-4 py-2 text-sm text-[#c9a96e] disabled:opacity-50"
                    >
                      {validating === provider.id ? "Validating..." : "Validate"}
                    </button>
                    <button
                      type="submit"
                      disabled={saving === provider.id || !(keyInputs[provider.id] || "").trim()}
                      className={primaryButtonClass}
                    >
                      {saving === provider.id ? "Validating & saving..." : "Save key"}
                    </button>

                    {validation && (
                      <p
                        className={`w-full text-xs ${
                          validation.valid ? "text-green-400" : "text-red-300"
                        }`}
                      >
                        {validation.valid ? "✓ Key is valid." : validation.error}
                      </p>
                    )}
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </SettingsCard>
    </div>
  );
}
