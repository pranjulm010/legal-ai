import uuid
from django.db import models


class UploadedDocument(models.Model):
    DOCUMENT_TYPES = [
        ("pdf", "PDF"),
        ("scanned_pdf", "Scanned PDF"),
        ("docx", "DOCX"),
        ("txt", "TXT"),
        ("md", "Markdown"),
        ("pptx", "PowerPoint"),
        ("jpg", "JPEG Image"),
        ("jpeg", "JPEG Image"),
        ("png", "PNG Image"),
    ]

    document_id = models.UUIDField(
        default=uuid.uuid4,
        unique=True,
        editable=False
    )

    file = models.FileField(upload_to="documents/")
    original_name = models.CharField(max_length=255)

    document_type = models.CharField(
        max_length=30,
        choices=DOCUMENT_TYPES
    )

    total_chunks = models.IntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    tags = models.CharField(max_length=500, blank=True, default="", help_text="Comma-separated")
    extracted_entities = models.JSONField(default=dict, blank=True)

    case = models.ForeignKey(
        "cases.Case",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="documents",
    )

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="documents",
    )

    SOURCE_CHOICES = [
        ("upload", "Manual Upload"),
        ("drive", "Google Drive"),
    ]
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default="upload")
    drive_file_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    drive_modified_at = models.DateTimeField(null=True, blank=True)

    # Chunking + embedding happens in a background thread after upload so
    # the HTTP response returns immediately - large documents can take well
    # over the ~30s a dev-mode proxy (Next.js rewrites, ngrok, etc.) is
    # willing to hold a request open for. Existing rows default to "ready"
    # since they were already fully processed under the old synchronous flow.
    STATUS_CHOICES = [
        ("processing", "Processing"),
        ("ready", "Ready"),
        ("failed", "Failed"),
    ]
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ready")
    error_message = models.CharField(max_length=500, blank=True, default="")

    # Version history: uploading a new version creates a NEW row (its own
    # document_id, chunks, embeddings) linked back to the one it replaces,
    # rather than overwriting the existing row in place - so the previous
    # version's content stays queryable/comparable rather than being lost.
    # version_number counts up from 1 within one version chain;
    # previous_version is null for the first upload in a chain.
    version_number = models.PositiveIntegerField(default=1)
    previous_version = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="next_versions",
    )

    def __str__(self):
        return self.original_name


class ChatSession(models.Model):
    """
    A resumable conversation thread - groups a sequence of ChatMessages so
    a lawyer can pick up where they left off instead of every question
    being a stateless one-off. Visible firm-wide (any lawyer at the firm
    can open and continue any session), matching the existing firm-wide
    visibility of the Knowledge page's chat search - this is a
    collaboration tool, not a private per-user inbox.
    """

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        related_name="chat_sessions",
    )
    started_by = models.ForeignKey(
        "accounts.LawyerProfile",
        on_delete=models.SET_NULL,
        null=True,
        related_name="+",
    )
    title = models.CharField(max_length=255, blank=True, default="")
    document = models.ForeignKey(
        UploadedDocument,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chat_sessions",
    )

    # The single case the conversation has most recently narrowed down to -
    # e.g. "how many open cases" resolving to exactly one, or a case being
    # looked up by name/title. Set whenever a turn resolves unambiguously
    # to one case, cleared whenever a turn resolves to zero or several, so
    # a bare follow-up like "what is it about?"/"who is the client?" can
    # be answered without asking the user to repeat the case's name -
    # without this, that resolution only ever happened via the LLM
    # re-guessing from raw history text each turn, which isn't reliable
    # enough to guarantee "the one case we just discussed" is used, only
    # to attempt to.
    active_case = models.ForeignKey(
        "cases.Case",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]

    def __str__(self):
        return self.title or f"Chat session {self.id}"


class ChatMessage(models.Model):
    session = models.ForeignKey(
        ChatSession,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="messages",
    )

    document = models.ForeignKey(
        UploadedDocument,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="chats"
    )

    firm = models.ForeignKey(
        "accounts.Firm",
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="chat_messages",
    )

    question = models.TextField()
    answer = models.TextField()

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return self.question[:80]


class AgentLesson(models.Model):
    """
    Persistent, cross-session record of a mistake the AI agent (see
    rag/research_agent.py) actually made and caught via its own reflection
    check - e.g. fabricating a case citation that wasn't in any tool
    result. Unlike the agent's ordinary conversation memory (which resets
    every new chat), these rows persist in the database and get replayed
    into the system prompt of every future agent run platform-wide, so a
    mistake caught once becomes a standing instruction rather than being
    forgotten the moment the conversation ends. Not model fine-tuning -
    this is prompt-level accumulated correction, the practical way to
    "learn from mistakes" without retraining weights.
    """
    question = models.TextField()
    flawed_answer = models.TextField()
    lesson = models.TextField(help_text="Short, general instruction derived from the mistake.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.lesson[:80]