from django.contrib.auth.models import User
from django.db import models


class Firm(models.Model):
    SIZE_CHOICES = [
        ("solo", "Solo (just me)"),
        ("small", "Small (2-10 lawyers)"),
        ("mid", "Medium (11-50 lawyers)"),
        ("large", "Large (51-200 lawyers)"),
        ("enterprise", "Enterprise (200+ lawyers)"),
    ]

    REGION_CHOICES = [
        ("india", "India"),
        ("usa", "United States"),
        ("uk", "United Kingdom"),
        ("canada", "Canada"),
        ("australia", "Australia"),
        ("singapore", "Singapore"),
        ("eu", "European Union"),
        ("middle_east", "Middle East"),
    ]

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True)
    size = models.CharField(max_length=10, choices=SIZE_CHOICES, default="solo")
    bar_registration_number = models.CharField(max_length=100, blank=True, default="")
    address = models.CharField(max_length=500, blank=True, default="")
    official_email_domain = models.CharField(max_length=255, blank=True, default="")

    practice_areas = models.CharField(
        max_length=500, blank=True, default="",
        help_text="Comma-separated, e.g. 'Corporate, Civil, Family'",
    )
    employee_count = models.PositiveIntegerField(default=0)
    lawyer_count = models.PositiveIntegerField(default=0)
    office_locations = models.TextField(blank=True, default="")
    phone = models.CharField(max_length=30, blank=True, default="")
    website = models.URLField(blank=True, default="")
    gst_number = models.CharField(max_length=20, blank=True, default="")
    logo = models.ImageField(upload_to="firm_logos/", blank=True, null=True)

    is_active = models.BooleanField(
        default=True,
        help_text="Suspended firms cannot log in - enforced in JWTAuth.",
    )

    default_region = models.CharField(
        max_length=20,
        choices=REGION_CHOICES,
        default="india",
        help_text="Jurisdiction used for web search when a question doesn't specify one.",
    )

    AI_PROVIDER_MODE_CHOICES = [
        ("platform_managed", "Platform Managed (SaaS)"),
        ("customer_managed", "Customer Managed (Bring Your Own API Key)"),
    ]
    ai_provider_mode = models.CharField(
        max_length=20,
        choices=AI_PROVIDER_MODE_CHOICES,
        default="platform_managed",
        help_text=(
            "Which API keys pay for this firm's AI requests. platform_managed "
            "(default) uses the platform's own keys - customer_managed routes "
            "every AI request through the firm's own connected provider "
            "credential instead. Never both at once - see rag/llm_client.py."
        ),
    )

    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class LawyerProfile(models.Model):
    ROLE_CHOICES = [
        ("admin", "Firm Admin"),
        ("partner", "Partner"),
        ("associate", "Associate"),
        ("paralegal", "Paralegal"),
        ("public", "Public User"),
    ]

    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name="lawyer_profile"
    )
    firm = models.ForeignKey(
        Firm,
        on_delete=models.CASCADE,
        related_name="lawyers"
    )
    role = models.CharField(
        max_length=20,
        choices=ROLE_CHOICES,
        default="associate"
    )
    department = models.CharField(max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.user.get_username()} ({self.firm.name})"


class GoogleDriveConnection(models.Model):
    """
    One connected Drive account per firm. Tokens are per-firm, not
    per-user, since the linked folder is a shared firm resource that any
    lawyer's questions should be able to search - same trust boundary as
    the firm's own uploaded documents.
    """

    firm = models.OneToOneField(
        Firm, on_delete=models.CASCADE, related_name="drive_connection"
    )
    connected_by = models.ForeignKey(
        LawyerProfile, on_delete=models.SET_NULL, null=True, related_name="+"
    )

    access_token = models.TextField(blank=True, default="")
    refresh_token = models.TextField(blank=True, default="")
    token_expiry = models.DateTimeField(null=True, blank=True)

    folder_id = models.CharField(max_length=255, blank=True, default="")
    folder_name = models.CharField(max_length=255, blank=True, default="")
    folder_link = models.URLField(blank=True, default="")

    last_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Drive connection for {self.firm.name}"


class AuditLog(models.Model):
    """Firm-wide audit trail for admin/security-relevant actions (team
    changes, firm profile edits, case deletion, etc.) - separate from
    CaseActivity, which is a per-case collaboration feed."""

    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="audit_logs")
    actor = models.ForeignKey(
        LawyerProfile, on_delete=models.SET_NULL, null=True, related_name="audit_actions"
    )
    action = models.CharField(max_length=100)
    details = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.action} ({self.firm.name})"


class RolePermissionOverride(models.Model):
    """
    Per-firm deviation from the hardcoded ROLE_PERMISSIONS default (see
    accounts/permissions.py). Deliberately an OVERRIDE table, not the
    source of truth - a firm with zero rows here behaves EXACTLY like the
    hardcoded matrix always has, so shipping this feature carries no risk
    to any of the ~19 existing require_permission() call sites across the
    codebase. "public" is intentionally never a valid role here (enforced
    in the API layer, not the model) - public users are always solo in
    their own isolated pseudo-firm with no team/case/draft/contact
    surface to customize.
    """

    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="permission_overrides")
    role = models.CharField(max_length=20, choices=LawyerProfile.ROLE_CHOICES)
    action = models.CharField(max_length=100)
    granted = models.BooleanField()
    updated_by = models.ForeignKey(
        LawyerProfile, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("firm", "role", "action")

    def __str__(self):
        return f"{self.firm.name}: {self.role}.{self.action} = {self.granted}"


class FirmSettings(models.Model):
    """
    Generic per-firm key-value settings store, namespaced by top-level key
    inside `data` (e.g. data["appearance"], data["notifications"]) so one
    row covers multiple unrelated Settings categories instead of a new
    model per category.
    """

    firm = models.OneToOneField(Firm, on_delete=models.CASCADE, related_name="settings")
    data = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Settings for {self.firm.name}"


class AIProviderCredential(models.Model):
    """
    A firm's own BYOK credential for one AI provider (Settings > AI
    Configuration > API Integrations). Only meaningful when
    Firm.ai_provider_mode == "customer_managed" - see rag/llm_client.py's
    get_ai_client(), the single choke point that decides whether a request
    uses the platform's own key or one of these. `enabled` is enforced to
    be true for at most one credential per firm (in the API layer, not the
    DB) - "exactly one active provider" is the whole point of this
    feature, mirroring RolePermissionOverride's "override table, not
    source of truth for the default case" philosophy: a firm with zero
    rows here, or with ai_provider_mode still "platform_managed", behaves
    exactly as it always has.
    """

    PROVIDER_CHOICES = [
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("google_gemini", "Google Gemini"),
        ("azure_openai", "Azure OpenAI"),
        ("groq", "Groq"),
        ("mistral", "Mistral"),
    ]

    STATUS_CHOICES = [
        ("untested", "Untested"),
        ("connected", "Connected"),
        ("failed", "Failed"),
    ]

    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="ai_provider_credentials")
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)

    # Fernet-encrypted (accounts/encryption.py) - never store or return
    # plaintext. NEVER exposed to the frontend; API responses only ever
    # return a masked hint (e.g. last 4 chars).
    encrypted_api_key = models.TextField()

    # Azure OpenAI needs a resource endpoint; some providers/self-hosted
    # gateways may need a base_url override. Blank for providers that
    # don't need it.
    base_url = models.CharField(max_length=500, blank=True, default="")

    # Free-text model id (or, for Azure, the deployment name) rather than
    # a hardcoded dropdown - provider model catalogs change constantly and
    # a fixed choices list would go stale.
    model = models.CharField(max_length=200, blank=True, default="")

    # Provider-specific extras, e.g. Azure's {"api_version": "2024-10-21"}.
    extra_config = models.JSONField(default=dict, blank=True)

    enabled = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="untested")
    last_tested_at = models.DateTimeField(null=True, blank=True)
    last_test_message = models.CharField(max_length=500, blank=True, default="")

    created_by = models.ForeignKey(
        LawyerProfile, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("firm", "provider")

    def __str__(self):
        return f"{self.firm.name}: {self.provider} ({self.status})"
