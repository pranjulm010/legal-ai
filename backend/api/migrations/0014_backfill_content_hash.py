import hashlib

from django.db import migrations


def backfill_content_hash(apps, schema_editor):
    """Compute content_hash for documents uploaded before the field existed,
    so duplicate detection also catches re-uploading a file that was already
    in the knowledge base. Best-effort: a document whose underlying file is
    missing or unreadable is simply skipped (its hash stays empty), never
    failing the migration."""
    UploadedDocument = apps.get_model("api", "UploadedDocument")

    for document in UploadedDocument.objects.filter(content_hash="").iterator():
        try:
            file = document.file
            if not file:
                continue
            file.open("rb")
            try:
                hasher = hashlib.sha256()
                for chunk in file.chunks():
                    hasher.update(chunk)
            finally:
                file.close()
            UploadedDocument.objects.filter(pk=document.pk).update(
                content_hash=hasher.hexdigest()
            )
        except Exception:
            # Missing/unreadable file (e.g. a failed upload) - leave it empty.
            continue


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0013_uploadeddocument_content_hash"),
    ]

    operations = [
        migrations.RunPython(backfill_content_hash, noop_reverse),
    ]
