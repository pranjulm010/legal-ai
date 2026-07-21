"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import DriveTab from "@/components/settings/DriveTab";
import LlmTab from "@/components/settings/LlmTab";
import ProfileTab from "@/components/settings/ProfileTab";
import TeamTab from "@/components/settings/TeamTab";

// Adding a future settings section = one new entry here plus its tab
// component; the page shell below doesn't change.
const TABS = [
  { id: "profile", label: "Profile" },
  { id: "team", label: "Team" },
  { id: "llm", label: "LLM Configuration" },
  { id: "drive", label: "Google Drive" },
] as const;

type TabId = (typeof TABS)[number]["id"];

const isTabId = (value: string | null): value is TabId =>
  TABS.some((tab) => tab.id === value);

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [ready, setReady] = useState(false);

  // Deep-linking: ?tab=team opens that tab directly, and the Google Drive
  // OAuth redirect (?drive_connected / ?drive_error) lands on the Drive tab.
  // Read from window.location instead of useSearchParams so the page needs
  // no Suspense boundary (same pattern the Drive OAuth handling already used).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");

    if (isTabId(requested)) {
      setActiveTab(requested);
    } else if (params.get("drive_connected") || params.get("drive_error")) {
      setActiveTab("drive");
    }

    setReady(true);
  }, []);

  const selectTab = (tab: TabId) => {
    setActiveTab(tab);
    window.history.replaceState({}, "", `${window.location.pathname}?tab=${tab}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[#f0e6cc]">Settings</h1>
        <p className="mt-1 text-sm text-[#8a7c68]">
          Your profile, team, AI model, and integrations — all in one place.
        </p>
      </div>

      {/* Tab bar - scrolls horizontally on narrow screens */}
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto border-b border-[#c9a96e]/10"
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => selectTab(tab.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? "border-[#c9a96e] font-semibold text-[#f0e6cc]"
                : "border-transparent text-[#8a7c68] hover:text-[#c9a96e]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Render only after the URL has been read, so a deep-linked tab never
          flashes the default one (and DriveTab sees the OAuth params). */}
      {ready && (
        <div role="tabpanel">
          {activeTab === "profile" && <ProfileTab isAdmin={isAdmin} />}
          {activeTab === "team" && <TeamTab isAdmin={isAdmin} />}
          {activeTab === "llm" && <LlmTab isAdmin={isAdmin} />}
          {activeTab === "drive" && <DriveTab isAdmin={isAdmin} />}
        </div>
      )}
    </div>
  );
}
