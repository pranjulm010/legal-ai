// Canonical list of every Settings category. This is the single source of
// truth for the rail nav, the search index, and which categories are
// gated behind the "manage_team" permission - see SettingsShell.

export interface SettingsCategory {
  id: string;
  label: string;
  group: string;
  description: string;
  searchTerms: string[];
  // true = wired to a real backend model/endpoint. false = UI-only mock
  // (realistic data, persisted to FirmSettings' "mock" namespace, but
  // doesn't drive any actual platform behavior). Every mock panel says so
  // via an honest banner - see MockPanel.
  real: boolean;
  // Hide this tab entirely for lawyers without "manage_team" - mirrors the
  // backend gate on the endpoints these panels call.
  requiresManageTeam?: boolean;
}

export const GROUP_ORDER = ["Organization", "Knowledge & AI", "Integrations", "Platform"];

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "workspace",
    label: "Workspace",
    group: "Organization",
    description: "Firm profile, branding, and contact details.",
    searchTerms: ["firm", "profile", "logo", "address", "bar registration", "gst"],
    real: true,
  },
  {
    id: "team",
    label: "Team Management",
    group: "Organization",
    description: "Lawyers, roles, invitations, and CSV import.",
    searchTerms: ["lawyers", "users", "invite", "roles", "csv"],
    real: true,
    requiresManageTeam: true,
  },
  {
    id: "ai-configuration",
    label: "AI Configuration",
    group: "Knowledge & AI",
    description: "AI Provider Mode - platform managed or bring your own key.",
    searchTerms: ["ai", "model", "groq", "llm", "provider mode", "byok"],
    real: true,
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    group: "Knowledge & AI",
    description: "Indexed documents and vector database status.",
    searchTerms: ["knowledge base", "documents", "vector", "chroma", "index", "reindex"],
    real: true,
  },
  {
    id: "data-connectors",
    label: "Data Connectors",
    group: "Integrations",
    description: "Google Drive integration.",
    searchTerms: ["drive", "google drive", "storage", "sync"],
    real: true,
  },
  {
    id: "api-integrations",
    label: "API Integrations",
    group: "Integrations",
    description: "Connect your own AI provider API keys for Customer Managed mode.",
    searchTerms: ["api key", "openai", "anthropic", "groq", "gemini", "mistral", "azure", "byok", "llm provider"],
    real: true,
    requiresManageTeam: true,
    // NOT hiddenWhenPlatformManaged: switching TO Customer Managed mode
    // requires an already-connected key (see AiConfigPanel's guard), so
    // this page must stay reachable while still in Platform Managed mode -
    // otherwise there'd be no way to ever satisfy that requirement. The
    // spec's "hide API Integrations in Platform Managed" is honored in
    // spirit instead: the panel clearly labels itself as inactive/unused
    // while the firm is in Platform Managed mode.
  },
  {
    id: "ocr-configuration",
    label: "OCR Configuration",
    group: "Knowledge & AI",
    description: "Scanned document text extraction settings.",
    searchTerms: ["ocr", "tesseract", "scanned", "text extraction"],
    real: true,
  },
  {
    id: "web-search",
    label: "Web Search Configuration",
    group: "Knowledge & AI",
    description: "Default region used for public web search fallback.",
    searchTerms: ["web search", "region", "google", "fallback"],
    real: true,
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "Platform",
    description: "Firm-wide notification preferences.",
    searchTerms: ["notifications", "alerts", "email digest"],
    real: true,
  },
  {
    id: "danger-zone",
    label: "Danger Zone",
    group: "Platform",
    description: "Irreversible firm-level actions.",
    searchTerms: ["danger", "delete firm", "deactivate"],
    real: true,
    requiresManageTeam: true,
  },
];

export function getCategory(id: string): SettingsCategory | undefined {
  return SETTINGS_CATEGORIES.find((c) => c.id === id);
}
