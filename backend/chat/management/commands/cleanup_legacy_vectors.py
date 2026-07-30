from django.core.management.base import BaseCommand

from rag.vector_store import get_chroma_client


class Command(BaseCommand):
    help = (
        "Delete Chroma collections left behind by the reverted self-learned "
        "cache experiment (self_learned_cache_firm_*)."
    )

    def handle(self, *args, **options):
        client = get_chroma_client()
        removed = 0
        for collection in client.list_collections():
            name = getattr(collection, "name", str(collection))
            if name.startswith("self_learned_cache_firm_"):
                client.delete_collection(name)
                removed += 1
                self.stdout.write(f"Deleted collection {name}")
        self.stdout.write(self.style.SUCCESS(f"Removed {removed} legacy collections."))
