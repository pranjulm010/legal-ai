from django.db import models

from accounts.models import Firm, LawyerProfile


class WorkspaceAIConfiguration(models.Model):
    """
    One row per workspace (Firm), deciding whether AI requests use the
    platform's own credentials or the workspace's own connected keys.

    This is an ADDITIVE, isolated configuration layer - see
    ai_provider/resolver.py, the only place this is actually read to
    influence routing, and rag/groq_client.py's get_groq_client(), the
    single surgical integration point into the existing AI codebase. A
    workspace with no row here is treated as PLATFORM (the resolver's
    default), so this feature is entirely opt-in and cannot change
    behavior for any workspace that never touches Settings > AI
    Configuration.
    """

    PLATFORM = "PLATFORM"
    CUSTOMER = "CUSTOMER"
    PROVIDER_MODE_CHOICES = [
        (PLATFORM, "Platform Managed (SaaS)"),
        (CUSTOMER, "Customer Managed (BYOK)"),
    ]

    workspace = models.OneToOneField(
        Firm, on_delete=models.CASCADE, related_name="ai_provider_configuration"
    )
    provider_mode = models.CharField(
        max_length=10, choices=PROVIDER_MODE_CHOICES, default=PLATFORM
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.workspace.name}: {self.provider_mode}"


class WorkspaceAPIKey(models.Model):
    """
    A workspace's own BYOK credential for one AI provider. Only consulted
    by AIProviderResolver when the workspace's WorkspaceAIConfiguration is
    CUSTOMER. Enforced (in the API layer, not the DB) that at most one row
    per workspace has enabled=True at a time - "exactly one active
    provider" mirrors "exactly one provider_mode" as the whole point of
    this feature. Never returned decrypted to the frontend - API
    responses only ever include a masked hint (see ai_provider/api.py).
    """

    PROVIDER_CHOICES = [
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("gemini", "Google Gemini"),
        ("groq", "Groq"),
        ("azure_openai", "Azure OpenAI"),
        ("mistral", "Mistral"),
    ]

    STATUS_CHOICES = [
        ("untested", "Untested"),
        ("connected", "Connected"),
        ("failed", "Failed"),
    ]

    workspace = models.ForeignKey(
        Firm, on_delete=models.CASCADE, related_name="ai_provider_api_keys"
    )
    provider = models.CharField(max_length=20, choices=PROVIDER_CHOICES)

    # Encrypted via ai_provider/encryption.py (Fernet) - never store or
    # return plaintext.
    encrypted_api_key = models.TextField()

    # Azure OpenAI needs a resource endpoint; some providers/self-hosted
    # gateways may need a base_url override. Blank for providers that
    # don't need it.
    base_url = models.CharField(max_length=500, blank=True, default="")

    # Free-text model id (or, for Azure, the deployment name) rather than
    # a hardcoded dropdown - provider model catalogs change constantly.
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
        unique_together = ("workspace", "provider")

    def __str__(self):
        return f"{self.workspace.name}: {self.provider} ({self.status})"
