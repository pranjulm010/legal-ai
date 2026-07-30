"""
Standing per-user style profile: a few bullet lines re-distilled from the
user's accumulated memories and injected verbatim into every system
prompt, so tone adaptation doesn't depend on which individual memories
happen to be retrieved for a given question.
"""
from chat.llm import fast_json_completion
from chat.prompts.memory import STYLE_SUMMARY_SYSTEM

_REFRESH_EVERY_N_MEMORIES = 5
_MAX_MEMORIES_FOR_SUMMARY = 50


def get_style_profile(user) -> str:
    from chat.models import UserStyleProfile

    profile = UserStyleProfile.objects.filter(user=user).first()
    return profile.summary if profile else ""


def maybe_refresh_style_profile(user) -> bool:
    """Re-summarize once enough new memories have accumulated. Returns
    whether a refresh ran."""
    from chat.models import MemoryEntry, UserStyleProfile

    profile, _ = UserStyleProfile.objects.get_or_create(user=user)
    active_count = MemoryEntry.objects.filter(user=user, is_active=True).count()

    if active_count - profile.memory_count_at_refresh < _REFRESH_EVERY_N_MEMORIES:
        return False

    memories = MemoryEntry.objects.filter(user=user, is_active=True).order_by(
        "-created_at"
    )[:_MAX_MEMORIES_FOR_SUMMARY]
    memory_lines = "\n".join(f"- [{m.kind}] {m.content}" for m in memories)

    data = fast_json_completion(
        [
            {"role": "system", "content": STYLE_SUMMARY_SYSTEM},
            {"role": "user", "content": f"Everything remembered about the user:\n{memory_lines}"},
        ],
        default={},
    )

    summary = (data.get("summary") or "").strip()
    if not summary:
        return False

    profile.summary = summary
    profile.memory_count_at_refresh = active_count
    profile.save()
    return True
