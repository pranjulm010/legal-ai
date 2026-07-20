// Mirrors backend/accounts/permissions.py - keep in sync.
export const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  admin: new Set([
    "manage_team",
    "create_case",
    "edit_case",
    "delete_case",
    "generate_draft",
    "edit_draft",
    "delete_draft",
    "delete_document",
    "delete_chat",
    "manage_contacts",
  ]),
  partner: new Set([
    "create_case",
    "edit_case",
    "delete_case",
    "generate_draft",
    "edit_draft",
    "delete_draft",
    "delete_document",
    "delete_chat",
    "manage_contacts",
  ]),
  associate: new Set([
    "create_case",
    "edit_case",
    "generate_draft",
    "edit_draft",
    "delete_chat",
    "manage_contacts",
  ]),
  paralegal: new Set([]),
  public: new Set(["delete_document", "delete_chat"]),
};

// `live`, when provided, is the effective action list fetched from
// GET /auth/my-permissions/ (accounts for per-firm RBAC overrides on top of
// the hardcoded defaults above). Pass it whenever it's available - the
// hardcoded matrix here is only a fallback for the brief window before it
// loads, since a firm can now grant/revoke actions per role at runtime.
export function hasPermission(
  role: string | undefined,
  action: string,
  live?: string[] | null
): boolean {
  if (live) return live.includes(action);
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}
