from django.db import models


class MessageFeedback(models.Model):
    """
    A thumbs up/down rating one user gave one AI answer. Feeds the Memory
    RAG (a thumbs-down becomes a "feedback" MemoryEntry) so future answers
    for that user adapt. Attributed to the rater, not session.started_by -
    sessions are firm-visible but feedback is personal.
    """

    RATING_CHOICES = [("up", "Up"), ("down", "Down")]

    message = models.ForeignKey(
        "api.ChatMessage",
        on_delete=models.CASCADE,
        related_name="feedback",
    )
    user = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.CASCADE,
        related_name="+",
    )
    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="+",
    )
    rating = models.CharField(max_length=4, choices=RATING_CHOICES)
    comment = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["message", "user"], name="uniq_feedback_per_user"
            )
        ]

    def __str__(self):
        return f"{self.rating} on message {self.message_id}"


class MemoryEntry(models.Model):
    """
    One distilled fact the assistant knows about a user - a preference,
    style observation, correction, feedback takeaway, or standing fact.
    The SQL row is the source of truth; its content is embedded into the
    user's Chroma memory collection (id "mem_{pk}") which is a rebuildable
    index. Raw transcripts are never embedded.
    """

    KIND_CHOICES = [
        ("preference", "Preference"),
        ("style", "Style"),
        ("correction", "Correction"),
        ("feedback", "Feedback"),
        ("fact", "Fact"),
    ]

    user = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.CASCADE,
        related_name="memories",
    )
    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="+",
    )
    kind = models.CharField(max_length=12, choices=KIND_CHOICES)
    content = models.TextField()
    source_message = models.ForeignKey(
        "api.ChatMessage",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name_plural = "memory entries"

    def __str__(self):
        return f"[{self.kind}] {self.content[:60]}"


class UserStyleProfile(models.Model):
    """
    A short standing summary of how one user likes to be answered,
    re-distilled from their accumulated MemoryEntries every few new
    memories and injected verbatim into the system prompt.
    """

    user = models.OneToOneField(
        "accounts.LawyerProfile",
        on_delete=models.CASCADE,
        related_name="style_profile",
    )
    summary = models.TextField(blank=True, default="")
    memory_count_at_refresh = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Style profile for {self.user_id}"
