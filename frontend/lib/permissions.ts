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
    "edit_document",
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
    "edit_document",
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

export function hasPermission(role: string | undefined, action: string): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(action) ?? false;
}
