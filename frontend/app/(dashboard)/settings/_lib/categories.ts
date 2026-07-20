// Canonical list of every Settings category. This is the single source of
// truth for the rail nav and the search index.

export interface SettingsCategory {
  id: string;
  label: string;
  group: string;
  description: string;
  searchTerms: string[];
}

export const GROUP_ORDER = ["Organization", "Knowledge & AI", "Integrations", "Platform"];

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  {
    id: "workspace",
    label: "Workspace",
    group: "Organization",
    description: "Firm profile, branding, and contact details.",
    searchTerms: ["firm", "profile", "logo", "address", "bar registration", "gst"],
  },
  {
    id: "team",
    label: "Team Management",
    group: "Organization",
    description: "Lawyers, roles, invitations, and CSV import.",
    searchTerms: ["lawyers", "users", "invite", "roles", "csv", "team"],
  },
  {
    id: "ai-configuration",
    label: "AI Configuration",
    group: "Knowledge & AI",
    description: "AI Provider Mode - platform managed or bring your own key.",
    searchTerms: ["ai", "model", "groq", "llm", "provider mode", "byok"],
  },
  {
    id: "api-integrations",
    label: "API Integrations",
    group: "Knowledge & AI",
    description: "Connect your own AI provider API keys for Customer Managed mode.",
    searchTerms: ["api key", "openai", "anthropic", "groq", "gemini", "mistral", "azure", "byok", "llm provider"],
  },
  {
    id: "knowledge-base",
    label: "Knowledge Base",
    group: "Knowledge & AI",
    description: "Indexed documents and vector database status.",
    searchTerms: ["knowledge base", "documents", "vector", "chroma", "index"],
  },
  {
    id: "data-connectors",
    label: "Data Connectors",
    group: "Integrations",
    description: "Google Drive integration.",
    searchTerms: ["drive", "google drive", "storage", "sync"],
  },
  {
    id: "notifications",
    label: "Notifications",
    group: "Platform",
    description: "Firm-wide notification preferences.",
    searchTerms: ["notifications", "alerts", "email digest"],
  },
  {
    id: "danger-zone",
    label: "Danger Zone",
    group: "Platform",
    description: "Irreversible firm-level actions.",
    searchTerms: ["danger", "delete firm", "deactivate", "remove lawyer"],
  },
];

export function getCategory(id: string): SettingsCategory | undefined {
  return SETTINGS_CATEGORIES.find((c) => c.id === id);
}
