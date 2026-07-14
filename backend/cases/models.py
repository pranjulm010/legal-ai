from django.db import models

from accounts.models import Firm, LawyerProfile


class Case(models.Model):
    STATUS_CHOICES = [
        ("open", "Open"),
        ("in_progress", "In Progress"),
        ("on_hold", "On Hold"),
        ("closed", "Closed"),
    ]

    CASE_TYPE_CHOICES = [
        ("civil", "Civil"),
        ("criminal", "Criminal"),
        ("corporate", "Corporate"),
        ("family", "Family"),
        ("property", "Property"),
        ("other", "Other"),
    ]

    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="cases")
    title = models.CharField(max_length=255)
    case_type = models.CharField(max_length=20, choices=CASE_TYPE_CHOICES, default="other")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    description = models.TextField(blank=True, default="")
    client_name = models.CharField(max_length=255, blank=True, default="")
    drive_link = models.URLField(blank=True, default="")

    created_by = models.ForeignKey(
        LawyerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_cases",
    )
    assigned_lawyers = models.ManyToManyField(
        LawyerProfile,
        related_name="assigned_cases",
        blank=True,
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title


class Reminder(models.Model):
    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="reminders")
    title = models.CharField(max_length=255)
    notes = models.TextField(blank=True, default="")
    due_date = models.DateTimeField()
    is_completed = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        LawyerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_reminders",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"{self.title} ({self.case.title})"


class CaseActivity(models.Model):
    ACTIVITY_TYPE_CHOICES = [
        ("comment", "Comment"),
        ("case_created", "Case Created"),
        ("status_changed", "Status Changed"),
        ("reminder_added", "Reminder Added"),
        ("reminder_completed", "Reminder Completed"),
        ("document_uploaded", "Document Uploaded"),
        ("draft_generated", "Draft Generated"),
        ("lawyers_updated", "Assigned Lawyers Updated"),
    ]

    case = models.ForeignKey(Case, on_delete=models.CASCADE, related_name="activities")
    actor = models.ForeignKey(
        LawyerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name="case_activities",
    )
    activity_type = models.CharField(
        max_length=30,
        choices=ACTIVITY_TYPE_CHOICES,
        default="comment",
    )
    body = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "case activities"

    def __str__(self):
        return f"{self.activity_type} on {self.case.title}"


class Contact(models.Model):
    firm = models.ForeignKey(Firm, on_delete=models.CASCADE, related_name="contacts")
    case = models.ForeignKey(
        Case, on_delete=models.SET_NULL, null=True, blank=True, related_name="contacts"
    )
    name = models.CharField(max_length=255)
    email = models.EmailField(blank=True, default="")
    phone = models.CharField(max_length=50, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        LawyerProfile,
        on_delete=models.SET_NULL,
        null=True,
        related_name="created_contacts",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
