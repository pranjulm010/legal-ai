from django.db import models


class Form(models.Model):
    """
    A legal/court form the firm works with (e.g. "Form 32A - Affidavit of
    Service"). Served to the chatbot through the get_form_details tool and
    managed via minimal firm-scoped CRUD.
    """

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="forms",
    )
    title = models.CharField(max_length=255)
    code = models.CharField(max_length=50, blank=True, default="")
    category = models.CharField(max_length=100, blank=True, default="")
    jurisdiction = models.CharField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True, default="")
    required_fields = models.JSONField(default=list, blank=True)
    submission_url = models.URLField(blank=True, default="")
    file = models.FileField(upload_to="forms/", null=True, blank=True)
    created_by = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["title"]

    def __str__(self):
        return f"{self.code} {self.title}".strip()
