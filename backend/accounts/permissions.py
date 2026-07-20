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


# Every action that appears in ROLE_PERMISSIONS for any role - the
# canonical action list the RBAC settings panel edits. Derived once here
# rather than hardcoded a second time in the API layer.
ALL_ACTIONS = sorted(set().union(*ROLE_PERMISSIONS.values()))


def has_permission(role: str, action: str, firm=None) -> bool:
    """
    firm is optional and defaults to None, preserving the exact old
    behavior (hardcoded matrix only) for every existing caller that
    doesn't pass it - e.g. api/tests.py's direct has_permission(role,
    action) calls, which are the regression proof that "no override
    exists = identical to today's behavior". When firm IS given and a
    RolePermissionOverride row exists for (firm, role, action), that row
    wins; otherwise falls through to the hardcoded default exactly as
    before. Local import to avoid a module-load-order dependency between
    permissions.py (pure logic, no Django app config needed) and
    models.py.
    """
    if firm is not None:
        from .models import RolePermissionOverride

        override = (
            RolePermissionOverride.objects.filter(firm=firm, role=role, action=action)
            .values_list("granted", flat=True)
            .first()
        )
        if override is not None:
            return override

    return action in ROLE_PERMISSIONS.get(role, set())


def require_permission(request, action: str) -> Optional[Tuple[int, dict]]:
    """Returns a (status, body) error tuple if denied, otherwise None."""
    role = request.auth.role
    firm = getattr(request.auth, "firm", None)

    if not has_permission(role, action, firm=firm):
        return 403, {
            "error": f"Your role ({role}) does not have permission to {action.replace('_', ' ')}."
        }

    return None
