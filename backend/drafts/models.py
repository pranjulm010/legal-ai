from django.db import models


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
