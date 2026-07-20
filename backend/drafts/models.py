from django.db import models


class DraftTemplate(models.Model):
    """
    A reusable drafting template distilled from a sample document.

    A lawyer uploads a representative document (.docx/.pdf) once; the LLM
    extracts its structure, tone, formatting conventions and the variable
    "placeholders" (party names, dates, amounts, etc.). Later drafts can be
    generated in the exact same format by selecting this template and only
    filling in the case-specific values - so a document made today can be
    reproduced a month later without re-describing the format.
    """

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="draft_templates",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")

    # The uploaded sample document and its extracted plain text.
    sample_file = models.FileField(upload_to="templates/", null=True, blank=True)
    sample_original_name = models.CharField(max_length=255, blank=True, default="")
    sample_text = models.TextField(blank=True, default="")

    # LLM-distilled template facets (see rag.drafting.analyze_template).
    extracted_structure = models.TextField(blank=True, default="")
    tone = models.TextField(blank=True, default="")
    formatting_rules = models.TextField(blank=True, default="")
    # List of {"name": str, "description": str} the draft author fills in.
    placeholders = models.JSONField(default=list, blank=True)
    # The synthesized system instruction used at generation time.
    ai_prompt = models.TextField(blank=True, default="")

    version = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.SET_NULL,
        null=True,
        related_name="draft_templates",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return f"{self.name} (v{self.version})"


class Draft(models.Model):
    DRAFT_TYPE_CHOICES = [
        ("draft", "Drafted Document"),
        ("redline", "Redline Review"),
    ]

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="drafts",
    )
    case = models.ForeignKey(
        "cases.Case",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafts",
    )
    source_document = models.ForeignKey(
        "api.UploadedDocument",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="redline_drafts",
    )
    template = models.ForeignKey(
        "drafts.DraftTemplate",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="drafts",
    )
    draft_type = models.CharField(max_length=20, choices=DRAFT_TYPE_CHOICES)
    title = models.CharField(max_length=255)
    prompt = models.TextField(blank=True, default="")
    content = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.SET_NULL,
        null=True,
        related_name="drafts",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title


class RedlineSuggestion(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("accepted", "Accepted"),
        ("rejected", "Rejected"),
    ]

    draft = models.ForeignKey(Draft, on_delete=models.CASCADE, related_name="suggestions")
    order = models.PositiveIntegerField(default=0)
    original_text = models.TextField()
    suggested_text = models.TextField()
    reason = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")

    def __str__(self):
        return f"Suggestion {self.order} ({self.status})"
