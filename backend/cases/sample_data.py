import os

from django.core.files import File

from api.models import UploadedDocument
from rag.rag_pipeline import process_uploaded_document
from .models import Case, CaseActivity

SAMPLE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "rag", "sample_documents")

SAMPLE_FILES = [
    ("nda.txt", "Sample - Mutual NDA.txt"),
    ("rental_agreement.txt", "Sample - Residential Rental Agreement.txt"),
    ("employment_agreement.txt", "Sample - Employment Agreement.txt"),
]


def seed_sample_documents(firm, actor):
    """Creates a demo case pre-loaded with sample legal documents for a firm.

    Best-effort: skips silently on missing files or processing failures so
    it never blocks registration.
    """
    if Case.objects.filter(firm=firm, title="Sample Documents").exists():
        return

    case = Case.objects.create(
        firm=firm,
        title="Sample Documents",
        case_type="other",
        status="open",
        description=(
            "Auto-generated demo case with sample legal documents so you can "
            "try document upload, OCR, and Q&A right away."
        ),
        created_by=actor,
    )
    case.assigned_lawyers.add(actor)

    for filename, display_name in SAMPLE_FILES:
        source_path = os.path.join(SAMPLE_DIR, filename)

        if not os.path.exists(source_path):
            continue

        with open(source_path, "rb") as source_file:
            document = UploadedDocument.objects.create(
                original_name=display_name,
                document_type="txt",
                case=case,
                firm=firm,
            )
            document.file.save(filename, File(source_file), save=True)

        try:
            total_chunks = process_uploaded_document(document)
            document.total_chunks = total_chunks
            document.save()
        except Exception:
            continue

    CaseActivity.objects.create(
        case=case,
        actor=actor,
        activity_type="case_created",
        body="Sample documents loaded to help you get started.",
    )
