# Recreated frozen migration.
#
# This migration was applied to the live database (it is recorded in
# django_migrations) but its file was lost when the "self-learned cache"
# experiment was reverted, leaving migration state permanently behind the
# real schema. This file faithfully reproduces what the applied migration
# did - ChatMessage.cached/region/route columns and the SelfLearnedEntry
# table - so Django's migration state matches the database again. It is
# never re-executed; the follow-up migration removes the parts the new
# chat architecture does not keep.
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0001_initial"),
        ("api", "0014_backfill_content_hash"),
    ]

    operations = [
        migrations.AddField(
            model_name="chatmessage",
            name="cached",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="region",
            field=models.CharField(blank=True, default="", max_length=20),
        ),
        migrations.AddField(
            model_name="chatmessage",
            name="route",
            field=models.CharField(blank=True, default="", max_length=30),
        ),
        migrations.CreateModel(
            name="SelfLearnedEntry",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("question", models.TextField()),
                ("distilled_answer", models.TextField()),
                ("region", models.CharField(blank=True, default="", max_length=20)),
                ("last_verified", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "firm",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="+",
                        to="accounts.firm",
                    ),
                ),
            ],
        ),
    ]
