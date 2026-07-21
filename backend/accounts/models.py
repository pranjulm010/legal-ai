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


class FirmLLMConfig(models.Model):
    """
    A firm's own LLM API credentials, one row per provider. At most one
    config per firm is "active" - when none is, the firm runs on the
    platform's default model (settings.GROQ_API_KEY / GROQ_MODEL). Keys
    are per-firm, not per-user, for the same reason as
    GoogleDriveConnection tokens: every lawyer's questions run through
    the same firm-level pipeline, so the credential is a shared firm
    resource with the same trust boundary as the firm's documents.
    """

    PROVIDER_CHOICES = [
        ("groq", "Groq"),
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("gemini", "Google Gemini"),
    ]

    # Providers the pipeline can actually route requests through today.
    # Keys for the others can be stored/validated but not activated yet.
    ROUTABLE_PROVIDERS = ["groq"]

    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="llm_configs")
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)
    api_key = models.TextField()
    model_name = models.CharField(
        max_length=100, blank=True, default="",
        help_text="Optional override; empty means the provider/platform default model.",
    )
    is_active = models.BooleanField(default=False)
    last_validated_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        LawyerProfile, on_delete=models.SET_NULL, null=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["firm", "provider"], name="unique_llm_provider_per_firm"
            )
        ]

    def masked_key(self) -> str:
        # Never expose the stored key back to the client - last 4 chars is
        # enough for an admin to recognize which key they saved.
        tail = self.api_key[-4:] if len(self.api_key) >= 8 else ""
        return f"••••{tail}"

    def __str__(self):
        return f"{self.provider} config for {self.firm.name}"


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
