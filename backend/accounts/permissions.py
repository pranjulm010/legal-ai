from typing import Optional, Tuple

# Permission matrix. "manage_team" was previously enforced ad hoc via
# _require_admin(); everything else here is new, per-action gating.
ROLE_PERMISSIONS = {
    "admin": {
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
    },
    "partner": {
        "create_case",
        "edit_case",
        "delete_case",
        "generate_draft",
        "edit_draft",
        "delete_draft",
        "delete_document",
        "delete_chat",
        "manage_contacts",
    },
    "associate": {
        "create_case",
        "edit_case",
        "generate_draft",
        "edit_draft",
        "delete_chat",
        "manage_contacts",
    },
    "paralegal": set(),
    # Public users are always solo in their own isolated pseudo-firm (no
    # team, no shared case/draft/contact workspace to protect from each
    # other) - they can freely manage their own uploads/chats, but never
    # get case/draft/contact/team-management actions since those features
    # aren't shown to them at all.
    "public": {
        "delete_document",
        "delete_chat",
    },
}


def has_permission(role: str, action: str) -> bool:
    return action in ROLE_PERMISSIONS.get(role, set())


def require_permission(request, action: str) -> Optional[Tuple[int, dict]]:
    """Returns a (status, body) error tuple if denied, otherwise None."""
    role = request.auth.role

    if not has_permission(role, action):
        return 403, {
            "error": f"Your role ({role}) does not have permission to {action.replace('_', ' ')}."
        }

    return None
