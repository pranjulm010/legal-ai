"""
Answer-quality eval harness.

Runs the golden Q&A set (rag/evals/dataset.py) through the real RAG pipeline
over the bundled sample documents and prints a scorecard of retrieval recall,
answer correctness, groundedness, and scope correctness. Use it as the
before/after regression gate for any retrieval or generation change.

Examples:
  python manage.py run_evals                 # full run, LLM judge on
  python manage.py run_evals --no-judge      # fast/cheap: deterministic metrics only
  python manage.py run_evals --fresh         # rebuild the eval firm from scratch
  python manage.py run_evals --only nda-term rental-rent
  python manage.py run_evals --limit 5 --sleep 2
"""
from django.core.management.base import BaseCommand

from rag.evals.runner import run


class Command(BaseCommand):
    help = "Run the legal-AI answer-quality eval harness over the sample documents."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fresh", action="store_true",
            help="Rebuild the eval firm and re-embed the sample documents before running.",
        )
        parser.add_argument(
            "--no-judge", action="store_true",
            help="Skip the LLM correctness/groundedness judges (retrieval + scope only). Cheaper and offline-safe.",
        )
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Run only the first N cases.",
        )
        parser.add_argument(
            "--only", nargs="+", default=None, metavar="CASE_ID",
            help="Run only the named case id(s).",
        )
        parser.add_argument(
            "--sleep", type=float, default=1.0,
            help="Seconds to wait between cases to respect Groq rate limits (default 1.0).",
        )

    def handle(self, *args, **options):
        run(
            limit=options["limit"],
            only_ids=options["only"],
            use_judge=not options["no_judge"],
            fresh=options["fresh"],
            sleep=options["sleep"],
            log=self.stdout.write,
        )
