"""
Regression tests for the deterministic RAG routing engine (rag_pipeline.py)
- the policy that decides document vs firm-database vs web vs LLM-knowledge,
and when to ask for web-search consent. All retrieval/LLM calls are mocked
so this runs fast and offline; it's testing the ROUTING DECISIONS, not
answer quality (that needs a live LLM and is covered by manual/live
verification instead, as it has been throughout this project's development).

`rag` is not a registered Django app (no models of its own), but
`manage.py test` discovers any test*.py under the project root regardless -
run with: python manage.py test rag
"""
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from .rag_pipeline import answer_general_question, answer_question

# A syntactically valid (if made-up) UUID - _build_document_sources() does a
# real DB lookup keyed on this, since it's shared code also used by the live
# pipeline and not worth mocking away just for these tests.
_FAKE_DOC_UUID = "00000000-0000-0000-0000-000000000001"
_FAKE_DOC_UUID_2 = "00000000-0000-0000-0000-000000000002"


def _chunk(score, document_id=_FAKE_DOC_UUID, text="matching chunk text"):
    return {
        "text": text,
        "score": score,
        "metadata": {"document_id": document_id, "chunk_id": 1, "page_number": 1},
    }


@override_settings(RAG_RELEVANCE_DISTANCE_THRESHOLD=0.72)
class DocumentScopedRoutingTests(TestCase):
    """answer_question() - a question scoped to one selected document."""

    @patch("rag.rag_pipeline.generate_legal_answer", return_value="Here is the answer from the document.")
    @patch("rag.rag_pipeline.retrieve_context")
    def test_public_document_match_found_stops_at_document(self, mock_retrieve, mock_generate):
        mock_retrieve.return_value = [_chunk(score=0.3)]

        result = answer_question(
            question="what does clause 4 say",
            document_id="doc-1",
            firm_id=1,
            role="public",
        )

        self.assertEqual(result["route"], "uploaded_document")
        self.assertFalse(result["needs_web_confirmation"])
        mock_generate.assert_called_once()

    @patch("rag.rag_pipeline.retrieve_context", return_value=[])
    def test_public_no_document_match_no_explicit_web_asks_consent(self, mock_retrieve):
        result = answer_question(
            question="what is case1",
            document_id="doc-1",
            firm_id=1,
            role="public",
        )

        self.assertTrue(result["needs_web_confirmation"])
        self.assertIsNone(result["route"])

    @patch("rag.rag_pipeline.generate_legal_answer", return_value="Answer from firm database.")
    @patch("rag.rag_pipeline.retrieve_firm_context")
    @patch("rag.rag_pipeline.retrieve_context", return_value=[])
    def test_lawyer_falls_through_to_firm_database(self, mock_doc_retrieve, mock_firm_retrieve, mock_generate):
        mock_firm_retrieve.return_value = [_chunk(score=0.3, document_id=_FAKE_DOC_UUID_2)]

        result = answer_question(
            question="what does the NDA say about termination",
            document_id="doc-1",
            firm_id=1,
            role="admin",
        )

        self.assertEqual(result["route"], "firm_database")
        self.assertFalse(result["needs_web_confirmation"])

    @patch("rag.rag_pipeline.retrieve_firm_context", return_value=[])
    @patch("rag.rag_pipeline.retrieve_context", return_value=[])
    def test_lawyer_document_and_firm_db_both_empty_asks_consent(self, mock_doc_retrieve, mock_firm_retrieve):
        result = answer_question(
            question="what is case1",
            document_id="doc-1",
            firm_id=1,
            role="admin",
        )

        self.assertTrue(result["needs_web_confirmation"])

    @patch("rag.rag_pipeline.generate_web_grounded_answer", return_value="Answer from the web.")
    @patch("rag.rag_pipeline.search_legal_web")
    @patch("rag.rag_pipeline.retrieve_firm_context", return_value=[])
    @patch("rag.rag_pipeline.retrieve_context", return_value=[])
    def test_explicit_web_request_skips_the_consent_ask(
        self, mock_doc_retrieve, mock_firm_retrieve, mock_search_web, mock_generate
    ):
        mock_search_web.return_value = [{"title": "A case", "source_site": "indiankanoon.org", "snippet": "..."}]

        result = answer_question(
            question="search the web for recent judgments on this",
            document_id="doc-1",
            firm_id=1,
            role="admin",
        )

        self.assertFalse(result["needs_web_confirmation"])
        self.assertEqual(result["route"], "web_search")
        mock_search_web.assert_called_once()


@override_settings(RAG_RELEVANCE_DISTANCE_THRESHOLD=0.72)
class GeneralQuestionRoutingTests(SimpleTestCase):
    """answer_general_question() - no document selected."""

    @patch("rag.rag_pipeline.try_answer_firm_stats", return_value="You have 3 case(s) in total.")
    def test_meta_question_answered_from_stats_never_reaches_retrieval(self, mock_stats):
        firm = type("Firm", (), {"id": 1})()

        result = answer_general_question(
            question="how many cases do I have",
            firm=firm,
            role="admin",
        )

        self.assertEqual(result["route"], "firm_database")
        self.assertEqual(result["confidence_level"], "High")
        mock_stats.assert_called_once()

    @patch("rag.rag_pipeline.try_answer_firm_stats", return_value=None)
    @patch("rag.rag_pipeline._match_document_by_name", return_value=None)
    @patch("rag.rag_pipeline.retrieve_firm_context", return_value=[])
    def test_no_match_anywhere_asks_consent_not_llm_directly(
        self, mock_retrieve, mock_match_name, mock_stats
    ):
        firm = type("Firm", (), {"id": 1})()

        with patch("api.models.UploadedDocument.objects") as mock_docs:
            mock_docs.filter.return_value.exists.return_value = True  # firm has documents
            result = answer_general_question(
                question="what is case1",
                firm=firm,
                role="admin",
            )

        self.assertTrue(result["needs_web_confirmation"])
