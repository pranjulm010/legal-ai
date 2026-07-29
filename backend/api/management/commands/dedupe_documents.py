"""Remove duplicate uploaded documents (same firm + identical content_hash).

Firms had the same file uploaded more than once, producing duplicate chunks
that pollute retrieval (this is what made a "who is X" answer see only one of a
person's matters). New uploads are now blocked at the source by content_hash;
this command cleans up the duplicates that already exist.

For each (firm, content_hash) group it KEEPS one document - preferring a
case-linked copy, otherwise the oldest - and removes the rest. Before deleting a
duplicate, every reference to it is re-pointed to the keeper so nothing is lost:
  - ChatMessage.document is CASCADE, so a naive delete would destroy chat
    history - these are reassigned to the keeper instead.
  - ChatSession.document and Draft.source_document are reassigned too.
  - If the keeper has no case but a duplicate does, the keeper inherits it.
A duplicate's vector chunks and stored file are then deleted with the same
helpers the normal delete endpoint uses.

Dry-run by default: pass --apply to actually make changes.
"""

from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from api.models import ChatMessage, ChatSession, UploadedDocument
from rag.vector_store import delete_document_chunks


class Command(BaseCommand):
    help = "Remove duplicate uploaded documents (same firm + content_hash), preserving references."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually delete duplicates. Without this flag the command only reports what it would do.",
        )

    def handle(self, *args, **options):
        apply = options["apply"]

        # Group ready/processing docs that have a hash by (firm, hash). Failed
        # rows and un-hashed rows (empty hash) are left alone.
        groups = defaultdict(list)
        for doc in (
            UploadedDocument.objects.exclude(content_hash="")
            .exclude(status="failed")
            .order_by("uploaded_at")
        ):
            groups[(doc.firm_id, doc.content_hash)].append(doc)

        dup_groups = {k: v for k, v in groups.items() if len(v) > 1}

        if not dup_groups:
            self.stdout.write(self.style.SUCCESS("No duplicate documents found."))
            return

        total_removed = 0
        for (firm_id, _hash), docs in dup_groups.items():
            # Keeper: prefer a case-linked copy (preserves the case association),
            # otherwise the oldest (docs are already ordered by uploaded_at).
            keeper = next((d for d in docs if d.case_id), docs[0])
            duplicates = [d for d in docs if d.pk != keeper.pk]

            self.stdout.write(
                f"\nfirm={firm_id}  '{keeper.original_name}'  "
                f"keep #{keeper.id}, remove {[d.id for d in duplicates]}"
            )

            for dup in duplicates:
                chat_msgs = ChatMessage.objects.filter(document=dup).count()
                chat_sessions = ChatSession.objects.filter(document=dup).count()
                self.stdout.write(
                    f"    - #{dup.id}: reassign {chat_msgs} chat message(s), "
                    f"{chat_sessions} session(s); delete chunks + file"
                )

                if not apply:
                    continue

                with transaction.atomic():
                    ChatMessage.objects.filter(document=dup).update(document=keeper)
                    ChatSession.objects.filter(document=dup).update(document=keeper)
                    # Draft.source_document -> keeper (imported lazily so this
                    # command doesn't hard-depend on the drafts app at import
                    # time).
                    try:
                        from drafts.models import Draft

                        Draft.objects.filter(source_document=dup).update(
                            source_document=keeper
                        )
                    except Exception:
                        pass

                    # If the keeper isn't linked to a case but this duplicate is,
                    # let the keeper inherit that association before we drop it.
                    if not keeper.case_id and dup.case_id:
                        keeper.case_id = dup.case_id
                        keeper.save(update_fields=["case"])

                    # Same cleanup the delete endpoint does.
                    try:
                        delete_document_chunks(
                            document_id=str(dup.document_id), firm_id=dup.firm_id
                        )
                    except Exception as error:
                        self.stdout.write(
                            self.style.WARNING(f"      (chunk cleanup warning: {error})")
                        )
                    if dup.file:
                        dup.file.delete(save=False)
                    dup.delete()

                total_removed += 1

        if apply:
            self.stdout.write(
                self.style.SUCCESS(f"\nDone. Removed {total_removed} duplicate document(s).")
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"\nDry run: {total_removed if total_removed else sum(len(v) - 1 for v in dup_groups.values())} "
                    "duplicate(s) would be removed. Re-run with --apply to do it."
                )
            )
