"""
Starter regression suite covering the highest-risk paths identified in the
architecture review: cross-firm data isolation, file upload validation, and
agent tool firm-scoping. Not full coverage - the goal is to make the things
a regression here would be most damaging to miss impossible to break
silently, which is exactly what this whole session had zero automated
protection against.

Run with: python manage.py test api
"""
import io
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase

from accounts.models import Firm, LawyerProfile
from accounts.rate_limit import rate_limit_exceeded
from api.models import UploadedDocument
from api.views import MAX_UPLOAD_SIZE_BYTES, _validate_uploaded_file
from cases.models import Case


def _register_firm(client, username, firm_name):
    response = client.post(
        "/api/auth/register/",
        {
            "username": username,
            "password": "TestPass123!",
            "email": f"{username}@example.com",
            "full_name": f"{username} Lawyer",
            "firm_name": firm_name,
            "firm_size": "solo",
        },
        content_type="application/json",
    )
    assert response.status_code == 201, response.content
    return response.json()["access"]


def _auth_header(token):
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


class FirmIsolationTests(TestCase):
    """
    The whole platform's multi-tenancy guarantee rests on every query being
    firm-scoped. This is the single most damaging thing to regress silently.
    """

    def setUp(self):
        self.token_a = _register_firm(self.client, "isotest_lawyer_a", "Isolation Firm A")
        self.token_b = _register_firm(self.client, "isotest_lawyer_b", "Isolation Firm B")

        case_response = self.client.post(
            "/api/cases/",
            {"title": "Firm A Confidential Matter", "case_type": "criminal", "client_name": "Secret Client"},
            content_type="application/json",
            **_auth_header(self.token_a),
        )
        assert case_response.status_code == 201, case_response.content
        self.firm_a_case_id = case_response.json()["id"]

    def test_firm_b_cannot_read_firm_a_case(self):
        response = self.client.get(f"/api/cases/{self.firm_a_case_id}/", **_auth_header(self.token_b))
        self.assertIn(response.status_code, (403, 404))

    def test_firm_b_cannot_delete_firm_a_case(self):
        response = self.client.delete(f"/api/cases/{self.firm_a_case_id}/", **_auth_header(self.token_b))
        self.assertIn(response.status_code, (403, 404))
        # and it must still exist for firm A afterwards
        still_there = self.client.get(f"/api/cases/{self.firm_a_case_id}/", **_auth_header(self.token_a))
        self.assertEqual(still_there.status_code, 200)

    def test_firm_a_can_read_its_own_case(self):
        response = self.client.get(f"/api/cases/{self.firm_a_case_id}/", **_auth_header(self.token_a))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Firm A Confidential Matter")

    def test_firm_list_endpoints_never_return_another_firms_rows(self):
        response = self.client.get("/api/cases/", **_auth_header(self.token_b))
        self.assertEqual(response.status_code, 200)
        titles = [case["title"] for case in response.json()]
        self.assertNotIn("Firm A Confidential Matter", titles)


class AgentToolFirmScopingTests(TestCase):
    """
    The AI agent's tools (agent_tools.py) bypass the normal view-layer
    _get_owned_document-style checks and do their own firm filtering
    directly in the ORM query - this is exactly the kind of thing that's
    easy to get subtly wrong (e.g. forgetting a firm= filter) without any
    test ever catching it, since the "attack" only shows up as a silent
    data leak, not an error.
    """

    def setUp(self):
        self.firm_a = Firm.objects.create(name="Agent Isolation Firm A", slug="agent-iso-firm-a", size="solo")
        self.firm_b = Firm.objects.create(name="Agent Isolation Firm B", slug="agent-iso-firm-b", size="solo")
        self.case_a = Case.objects.create(firm=self.firm_a, title="Firm A Case", case_type="civil")

    def test_get_case_info_refuses_cross_firm_lookup(self):
        from rag.agent_tools import tool_get_case_info

        result = tool_get_case_info(case_id=self.case_a.id, firm=self.firm_b)
        self.assertIn("error", result)
        self.assertNotIn("title", result)

    def test_get_case_info_succeeds_for_owning_firm(self):
        from rag.agent_tools import tool_get_case_info

        result = tool_get_case_info(case_id=self.case_a.id, firm=self.firm_a)
        self.assertEqual(result.get("title"), "Firm A Case")

    def test_compare_documents_refuses_document_outside_caller_firm(self):
        from rag.agent_tools import tool_compare_documents

        doc_a = UploadedDocument.objects.create(
            original_name="a.txt", document_type="txt", firm=self.firm_a,
        )
        doc_b = UploadedDocument.objects.create(
            original_name="b.txt", document_type="txt", firm=self.firm_b,
        )

        result = tool_compare_documents(
            document_id_a=str(doc_a.document_id),
            document_id_b=str(doc_b.document_id),
            firm=self.firm_b,
        )
        self.assertIn("error", result)


class RolePermissionTests(TestCase):
    """The RBAC matrix (accounts/permissions.py) is a plain lookup table -
    cheap to test exhaustively, expensive to get silently wrong."""

    def test_public_role_cannot_manage_team_or_cases(self):
        from accounts.permissions import has_permission

        for action in ("manage_team", "create_case", "edit_case", "delete_case", "generate_draft", "manage_contacts"):
            self.assertFalse(has_permission("public", action), f"public should not have {action}")

    def test_paralegal_has_no_case_or_draft_permissions(self):
        from accounts.permissions import has_permission

        for action in ("create_case", "edit_case", "delete_case", "generate_draft", "manage_team"):
            self.assertFalse(has_permission("paralegal", action), f"paralegal should not have {action}")

    def test_admin_has_full_permissions(self):
        from accounts.permissions import has_permission

        for action in ("manage_team", "create_case", "edit_case", "delete_case", "generate_draft", "delete_document", "manage_contacts"):
            self.assertTrue(has_permission("admin", action), f"admin should have {action}")

    def test_public_role_never_assignable_within_a_real_firm(self):
        from accounts.api import FIRM_ASSIGNABLE_ROLES

        self.assertNotIn("public", FIRM_ASSIGNABLE_ROLES)


class FileUploadValidationTests(TestCase):
    """
    _validate_uploaded_file is the one thing standing between "someone
    uploads a renamed .exe as a .pdf" and it silently reaching the
    document processor.
    """

    def test_rejects_oversized_file(self):
        fake_file = io.BytesIO(b"x" * 10)
        fake_file.size = MAX_UPLOAD_SIZE_BYTES + 1
        error = _validate_uploaded_file(fake_file, "pdf")
        self.assertIsNotNone(error)
        self.assertIn("too large", error.lower())

    def test_rejects_file_content_not_matching_extension(self):
        fake_file = io.BytesIO(b"this is definitely not a pdf file")
        fake_file.size = len(fake_file.getvalue())
        error = _validate_uploaded_file(fake_file, "pdf")
        self.assertIsNotNone(error)

    def test_accepts_genuine_pdf_signature(self):
        fake_file = io.BytesIO(b"%PDF-1.4\n%rest of a real pdf...")
        fake_file.size = len(fake_file.getvalue())
        error = _validate_uploaded_file(fake_file, "pdf")
        self.assertIsNone(error)

    def test_accepts_text_files_without_signature_check(self):
        # txt/md have no reliable magic bytes - any content should pass.
        fake_file = io.BytesIO(b"just plain text, no signature to check")
        fake_file.size = len(fake_file.getvalue())
        error = _validate_uploaded_file(fake_file, "txt")
        self.assertIsNone(error)


class RateLimitTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_allows_requests_under_the_limit(self):
        key = "test:rate:under-limit"
        for _ in range(3):
            self.assertFalse(rate_limit_exceeded(key, limit=5, window_seconds=60))

    def test_blocks_requests_over_the_limit(self):
        key = "test:rate:over-limit"
        for _ in range(5):
            rate_limit_exceeded(key, limit=5, window_seconds=60)
        self.assertTrue(rate_limit_exceeded(key, limit=5, window_seconds=60))

    def test_ask_question_endpoint_enforces_rate_limit(self):
        # Mocks the agent call so this test is fast and doesn't depend on
        # a live LLM API - it's verifying the rate-limit gate in the view,
        # not the AI's answer quality (that's covered by live testing
        # elsewhere, not something to run 30x per test suite execution).
        token = _register_firm(self.client, "ratelimit_lawyer", "Rate Limit Firm")
        cache.clear()

        canned_result = {
            "answer": "canned",
            "sources": [],
            "needs_web_confirmation": False,
            "research_steps": [],
            "route": "llm_knowledge",
            "confidence_level": "Low to Medium",
        }
        with patch("api.views.run_agent", return_value=canned_result):
            last_status = None
            for _ in range(35):
                response = self.client.post(
                    "/api/ask-question/",
                    {"question": "x"},
                    content_type="application/json",
                    **_auth_header(token),
                )
                last_status = response.status_code
        self.assertEqual(last_status, 429)
