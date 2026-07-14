from django.contrib.auth.models import User
from django.core.management.base import BaseCommand

from accounts.models import Firm, LawyerProfile


class Command(BaseCommand):
    help = "Seed the first Firm and an admin LawyerProfile for local dev."

    def add_arguments(self, parser):
        parser.add_argument("--firm-name", default="Default Law Firm")
        parser.add_argument("--username", default="admin")
        parser.add_argument("--password", default="admin12345")
        parser.add_argument("--email", default="admin@example.com")

    def handle(self, *args, **options):
        firm, _ = Firm.objects.get_or_create(
            slug="default-firm",
            defaults={"name": options["firm_name"]},
        )

        user, created = User.objects.get_or_create(
            username=options["username"],
            defaults={"email": options["email"]},
        )

        if created:
            user.set_password(options["password"])
            user.is_staff = True
            user.is_superuser = True
            user.save()

        LawyerProfile.objects.get_or_create(
            user=user,
            defaults={"firm": firm, "role": "admin"},
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded firm '{firm.name}' and admin user '{user.username}'."
            )
        )
