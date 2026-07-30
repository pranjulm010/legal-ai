"""
Offline regression tests for the chat pipeline's deterministic parts: the
tool registry's safety behavior (unknown tools, permissions, bad
arguments, firm scoping), the intent layer's fail-safe default, and the
memory writer's validation. LLM and vector-store calls are mocked - these
tests cover decisions, not answer quality (rag/evals is the live gate).

Run with: python manage.py test chat
"""
from unittest.mock import patch

from django.test import TestCase

from accounts.models import Firm, LawyerProfile
from cases.models import Case
from django.contrib.auth.models import User

from .intent import detect_intent
from .tools import ToolContext, dispatch


def _make_profile(firm, username, role):
    user = User.objects.create_user(username=username, password="x")
    return LawyerProfile.objects.create(user=user, firm=firm, role=role)


class ToolRegistryTests(TestCase):
    def setUp(self):
        self.firm_a = Firm.objects.create(name="Firm A", slug="reg-firm-a", size="solo")
        self.firm_b = Firm.objects.create(name="Firm B", slug="reg-firm-b", size="solo")
        self.admin_a = _make_profile(self.firm_a, "reg-admin-a", "admin")
        self.paralegal_a = _make_profile(self.firm_a, "reg-para-a", "paralegal")
        self.case_a = Case.objects.create(firm=self.firm_a, title="Firm A Case", case_type="civil")

    def _ctx(self, user):
        return ToolContext(user=user, firm=user.firm)

    def test_unknown_tool_returns_error_result(self):
        result = dispatch("no_such_tool", {}, self._ctx(self.admin_a))
        self.assertIn("unknown tool", result.content)

    def test_permission_gated_tool_denied_for_paralegal(self):
        result = dispatch("generate_draft", {"title": "t", "prompt": "p"}, self._ctx(self.paralegal_a))
        self.assertIn("not permitted", result.content)

    def test_hallucinated_arguments_are_dropped(self):
        result = dispatch(
            "get_case_link",
            {"case_id": self.case_a.id, "made_up_arg": True},
            self._ctx(self.admin_a),
        )
        self.assertIn(f"/cases/{self.case_a.id}", result.content)
        self.assertEqual(result.meta.get("link"), f"/cases/{self.case_a.id}")

    def test_get_case_details_refuses_cross_firm_lookup(self):
        admin_b = _make_profile(self.firm_b, "reg-admin-b", "admin")
        result = dispatch("get_case_details", {"case_id": self.case_a.id}, self._ctx(admin_b))
        self.assertIn("Case not found", result.content)

    def test_get_case_link_refuses_cross_firm_lookup(self):
        admin_b = _make_profile(self.firm_b, "reg-admin-b2", "admin")
        result = dispatch("get_case_link", {"case_id": self.case_a.id}, self._ctx(admin_b))
        self.assertIn("Case not found", result.content)

    def test_get_firm_overview_counts_only_own_firm(self):
        Case.objects.create(firm=self.firm_b, title="Firm B Case", case_type="civil")
        result = dispatch("get_firm_overview", {}, self._ctx(self.admin_a))
        self.assertIn('"total_cases": 1', result.content)
        self.assertIn("Firm A Case", result.content)
        self.assertNotIn("Firm B Case", result.content)


class IntentFailSafeTests(TestCase):
    def test_llm_failure_defaults_to_tools_route(self):
        with patch("chat.intent.fast_json_completion", return_value={"route": "tools"}):
            intent = detect_intent("anything", [], has_document=False, has_case=False)
        self.assertEqual(intent.route, "tools")
        self.assertFalse(intent.is_correction)

    def test_invalid_route_value_defaults_to_tools(self):
        with patch("chat.intent.fast_json_completion", return_value={"route": "banana"}):
            intent = detect_intent("anything", [], has_document=False, has_case=False)
        self.assertEqual(intent.route, "tools")

    def test_correction_requires_summary(self):
        with patch(
            "chat.intent.fast_json_completion",
            return_value={"route": "direct", "is_correction": True, "correction_summary": None},
        ):
            intent = detect_intent("no, wrong", [], has_document=False, has_case=False)
        self.assertFalse(intent.is_correction)


class MemoryWriterTests(TestCase):
    def setUp(self):
        self.firm = Firm.objects.create(name="Mem Firm", slug="mem-firm", size="solo")
        self.user = _make_profile(self.firm, "mem-user", "admin")

    @patch("chat.memory.writer.upsert_memory_vector")
    def test_invalid_kinds_and_blank_content_are_dropped(self, _mock_upsert):
        from chat.memory.writer import extract_and_store
        from chat.models import MemoryEntry

        with patch(
            "chat.memory.writer.fast_json_completion",
            return_value={
                "memories": [
                    {"kind": "preference", "content": "Prefers short answers."},
                    {"kind": "bogus", "content": "dropped"},
                    {"kind": "fact", "content": "   "},
                ]
            },
        ):
            stored = extract_and_store(self.user, self.firm, "q", "a")

        self.assertEqual(stored, 1)
        self.assertEqual(MemoryEntry.objects.filter(user=self.user).count(), 1)

    @patch("chat.memory.writer.upsert_memory_vector")
    def test_duplicate_memories_are_not_stored_twice(self, _mock_upsert):
        from chat.memory.writer import extract_and_store
        from chat.models import MemoryEntry

        payload = {"memories": [{"kind": "preference", "content": "Prefers SHORT answers."}]}
        with patch("chat.memory.writer.fast_json_completion", return_value=payload):
            extract_and_store(self.user, self.firm, "q", "a")
            # Same sentence, different case - still a duplicate.
            payload["memories"][0]["content"] = "prefers short answers."
            extract_and_store(self.user, self.firm, "q2", "a2")

        self.assertEqual(MemoryEntry.objects.filter(user=self.user).count(), 1)

    @patch("chat.memory.writer.upsert_memory_vector")
    def test_feedback_memory_records_comment(self, _mock_upsert):
        from api.models import ChatMessage
        from chat.memory.writer import record_feedback_memory
        from chat.models import MemoryEntry

        message = ChatMessage.objects.create(
            firm=self.firm, question="What is clause 4?", answer="...", asked_by=self.user
        )
        record_feedback_memory(self.user, message, comment="too verbose")

        entry = MemoryEntry.objects.get(user=self.user, kind="feedback")
        self.assertIn("too verbose", entry.content)
        self.assertIn("clause 4", entry.content)
