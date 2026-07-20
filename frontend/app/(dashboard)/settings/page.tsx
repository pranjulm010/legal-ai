"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { hasPermission } from "@/lib/permissions";
import { getAiProviderMode, type AiProviderModeValue } from "@/lib/api";
import { GROUP_ORDER, SETTINGS_CATEGORIES, getCategory } from "./_lib/categories";
import { useSettingsSearch } from "./_lib/useSettingsSearch";
import { SaveBarProvider } from "./_lib/SaveBarContext";
import { AiModeContext } from "./_lib/AiModeContext";
import SaveBar from "./_components/SaveBar";

import WorkspacePanel from "./_panels/WorkspacePanel";
import TeamManagementPanel from "./_panels/TeamManagementPanel";
import AiConfigPanel from "./_panels/AiConfigPanel";
import KnowledgeBasePanel from "./_panels/KnowledgeBasePanel";
import DataConnectorsPanel from "./_panels/DataConnectorsPanel";
import ApiIntegrationsPanel from "./_panels/ApiIntegrationsPanel";
import OcrConfigPanel from "./_panels/OcrConfigPanel";
import WebSearchPanel from "./_panels/WebSearchPanel";
import NotificationsPanel from "./_panels/NotificationsPanel";
import DangerZonePanel from "./_panels/DangerZonePanel";

const PANELS: Record<string, React.ComponentType> = {
  workspace: WorkspacePanel,
  team: TeamManagementPanel,
  "ai-configuration": AiConfigPanel,
  "knowledge-base": KnowledgeBasePanel,
  "data-connectors": DataConnectorsPanel,
  "api-integrations": ApiIntegrationsPanel,
  "ocr-configuration": OcrConfigPanel,
  "web-search": WebSearchPanel,
  notifications: NotificationsPanel,
  "danger-zone": DangerZonePanel,
};

const DEFAULT_TAB = "workspace";

function SettingsShellInner() {
  const { user, permissions } = useAuth();
  const canManageTeam = hasPermission(user?.role, "manage_team", permissions);

  const [activeTab, setActiveTab] = useState(DEFAULT_TAB);
  const [query, setQuery] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [aiMode, setAiMode] = useState<AiProviderModeValue | null>(null);

  const refreshAiMode = () => {
    getAiProviderMode()
      .then((result) => setAiMode(result.mode))
      .catch(() => {});
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && getCategory(tab)) setActiveTab(tab);
    setHydrated(true);
    refreshAiMode();
  }, []);

  const visibleCategories = useMemo(
    () => SETTINGS_CATEGORIES.filter((c) => !c.requiresManageTeam || canManageTeam),
    [canManageTeam]
  );

  const results = useSettingsSearch(query, visibleCategories);

  const grouped = useMemo(() => {
    const byGroup: Record<string, typeof results> = {};
    for (const group of GROUP_ORDER) byGroup[group] = [];
    for (const category of results) {
      (byGroup[category.group] ||= []).push(category);
    }
    return byGroup;
  }, [results]);

  // If the active tab becomes hidden (e.g. a manage_team override just
  // revoked it) or search filters it out, fall back to the first visible
  // result rather than rendering a blank panel.
  useEffect(() => {
    if (!hydrated) return;
    if (results.some((c) => c.id === activeTab)) return;
    if (results.length > 0) setActiveTab(results[0].id);
  }, [hydrated, results, activeTab]);

  const selectTab = (id: string) => {
    setActiveTab(id);
    window.history.replaceState({}, "", `${window.location.pathname}?tab=${id}`);
  };

  const ActivePanel = PANELS[activeTab] || WorkspacePanel;
  const activeCategory = getCategory(activeTab);

  return (
    <div className="-m-4 flex min-h-full flex-col bg-[#0b0906] text-[#e0d2ba] sm:-m-6 md:-m-8 md:flex-row">
      <aside className="w-full shrink-0 border-b border-[#c9a96e]/10 p-4 md:w-64 md:border-b-0 md:border-r md:p-5">
        <h1 className="mb-1 text-lg font-bold text-[#f0e6cc]">Settings</h1>
        <p className="mb-4 text-xs text-[#8a7c68]">{user?.firm_name}</p>

        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search settings..."
          className="mb-4 w-full rounded-lg border border-[#c9a96e]/15 bg-transparent px-3 py-2 text-sm text-[#e0d2ba] outline-none focus:border-[#c9a96e]/50"
        />

        <nav className="flex flex-col gap-4 md:max-h-[calc(100vh-180px)] md:overflow-y-auto">
          {GROUP_ORDER.map((group) =>
            grouped[group]?.length ? (
              <div key={group}>
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#8a7c68]">
                  {group}
                </p>
                <div className="flex flex-col gap-0.5">
                  {grouped[group].map((category) => (
                    <button
                      key={category.id}
                      onClick={() => selectTab(category.id)}
                      className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        activeTab === category.id
                          ? "bg-[#c9a96e]/15 text-[#f0e6cc]"
                          : "text-[#8a7c68] hover:text-[#c9a96e]"
                      }`}
                    >
                      {category.label}
                      {!category.real && (
                        <span className="ml-2 rounded-full bg-[#5a4f3f]/20 px-1.5 py-0.5 text-[9px] normal-case text-[#8a7c68]">
                          preview
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : null
          )}
          {results.length === 0 && (
            <p className="px-2 text-xs text-[#8a7c68]">No settings match &quot;{query}&quot;.</p>
          )}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          {activeCategory && !activeCategory.real && (
            <div className="mb-4 rounded-lg border border-[#c9a96e]/20 bg-[#c9a96e]/5 px-3 py-2 text-xs text-[#c9a96e]">
              Preview category - shown with realistic mock data, not yet wired to live behavior.
            </div>
          )}
          <AiModeContext.Provider value={{ mode: aiMode, refresh: refreshAiMode }}>
            <ActivePanel />
          </AiModeContext.Provider>
        </div>
        <SaveBar />
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <SaveBarProvider>
      <SettingsShellInner />
    </SaveBarProvider>
  );
}
