from django.core.management.base import BaseCommand, CommandError

from accounts.models import Firm, LawyerProfile
from cases.sample_data import seed_sample_documents


class Command(BaseCommand):
    help = "Seeds the 'Sample Documents' demo case (NDA, rental agreement, employment agreement) into a firm."

    def add_arguments(self, parser):
        parser.add_argument("--firm-id", type=int, help="Seed only this firm.")
        parser.add_argument("--all", action="store_true", help="Seed every firm that doesn't have sample docs yet.")

    def handle(self, *args, **options):
        firm_id = options.get("firm_id")
        seed_all = options.get("all")

        if not firm_id and not seed_all:
            raise CommandError("Pass --firm-id=<id> or --all.")

        firms = Firm.objects.filter(id=firm_id) if firm_id else Firm.objects.all()

        for firm in firms:
            admin_profile = (
                LawyerProfile.objects.filter(firm=firm, role="admin").first()
                or LawyerProfile.objects.filter(firm=firm).first()
            )

            if not admin_profile:
                self.stdout.write(self.style.WARNING(f"Skipping {firm.name}: no lawyers found."))
                continue

            seed_sample_documents(firm, admin_profile)
            self.stdout.write(self.style.SUCCESS(f"Seeded sample documents for {firm.name}."))
