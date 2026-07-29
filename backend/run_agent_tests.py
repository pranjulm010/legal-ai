"""
Ad-hoc behavioural test harness for the tool-calling research agent.
Runs a curated subset of the 50-case checklist against REAL seeded data
(Firm 2) by calling run_agent() directly, and auto-checks each result.
Run:  venv/bin/python run_agent_tests.py
"""
import os
import re
import sys
import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "legal_ai.settings")
django.setup()

from accounts.models import Firm, LawyerProfile
from drafts.models import Draft
from rag.research_agent import run_agent

FIRM = Firm.objects.get(id=2)
CREATED_BY = LawyerProfile.objects.get(id=2)  # admin, firm 2

# Real document / case IDs from firm 2
RENTAL_DOC = "26d67639-2664-46eb-8fca-5108b17ba9a8"   # Residential-Rental-Agreement.pdf (ready)
FIR_FAILED_DOC = "da0d1a42-79d4-4663-8c09-08d53bdc048b"  # fir.pdf (status=failed), case 4
CASE_LAND = 3        # "land issue", property
CASE_THEFT = 4       # "Mobile theft", criminal

GREEN, RED, YELLOW, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[0m"

results = []

def run(num, name, *, expect_fn, question, document_id=None, case_id=None,
        allow_web_search=False, firm_only=False, role="lawyer", history=None,
        pre=None, note=""):
    print(f"\n{'='*78}\n[{num}] {name}")
    print(f"    Q: {question!r}  (doc={bool(document_id)} case={case_id} web={allow_web_search} firm_only={firm_only})")
    ctx = {}
    if pre:
        ctx = pre() or {}
    try:
        res = run_agent(
            question=question, firm=FIRM, role=role, created_by=CREATED_BY,
            document_id=document_id, case_id=case_id,
            allow_web_search=allow_web_search, answer_mode="mixed",
            region="india", history=history or [], firm_only=firm_only,
        )
    except Exception as e:
        print(f"    {RED}ERROR calling agent: {type(e).__name__}: {e}{RESET}")
        results.append((num, name, "ERROR", str(e)))
        return
    answer = (res.get("answer") or "").strip()
    route = res.get("route")
    needs_web = res.get("needs_web_confirmation")
    steps = [s.get("sub_question", "") for s in res.get("research_steps", [])]
    print(f"    route={route} needs_web={needs_web}")
    print(f"    steps={steps}")
    print(f"    answer: {answer[:400]}")
    try:
        ok, why = expect_fn(answer, route, res, ctx)
    except Exception as e:
        ok, why = False, f"check raised {e}"
    tag = f"{GREEN}PASS{RESET}" if ok else f"{RED}FAIL{RESET}"
    print(f"    => {tag}  ({why})")
    results.append((num, name, "PASS" if ok else "FAIL", why))


def has(a, *subs):  # any substring present (case-insensitive)
    al = a.lower()
    return any(s.lower() in al for s in subs)

REFUSAL_NONLEGAL = "doesn't look like a legal question"

# ---------------- A. Retrieval & grounding ----------------
run(1, "Rent from attached rental agreement",
    question="What is the monthly rent in this agreement?",
    document_id=RENTAL_DOC,
    expect_fn=lambda a, r, res, c: (
        bool(re.search(r"\b(?:rs\.?|inr|₹|rupees|\d{3,})", a.lower())) and not has(a, "not in the document", "couldn't find"),
        "mentions a rent figure" ))

run(2, "Notice period, same doc (no 'which case?')",
    question="What is the notice period to terminate this agreement?",
    document_id=RENTAL_DOC,
    expect_fn=lambda a, r, res, c: (
        not has(a, "which case") and (has(a, "day", "month", "notice") ),
        "answers about notice period, no case clarification" ))

run(3, "Absent fact -> says not in document",
    question="What is the tenant's date of birth?",
    document_id=RENTAL_DOC,
    expect_fn=lambda a, r, res, c: (
        has(a, "not", "does not", "no ", "isn't", "couldn't"),
        "declines / says not present" ))

# ---------------- B. Firm data & stats ----------------
run(11, "Total case count (firm 2 has 7)",
    question="How many cases do we have in total?",
    expect_fn=lambda a, r, res, c: ("7" in a, "count 7 present; route=%s" % r))

run(12, "KEY: total count WHILE a case is open (tuple fix)",
    question="How many cases do we have in total?",
    case_id=CASE_THEFT,
    expect_fn=lambda a, r, res, c: (
        "7" in a and not has(a, "[", "null", "none, none"),
        "firm-wide 7, not garbled/confused with open case" ))

run(13, "List all lawyers",
    question="List all the lawyers in our firm.",
    expect_fn=lambda a, r, res, c: (
        sum(n in a for n in ["sumantest", "Pranjul", "skRoy", "Suman"]) >= 1,
        "names at least one real lawyer" ))

run(15, "Breakdown of cases by type",
    question="Give me a breakdown of our cases by type.",
    expect_fn=lambda a, r, res, c: (
        has(a, "corporate", "property", "criminal"),
        "shows real case types" ))

run(17, "Case lookup by name",
    question="Tell me about the land issue case.",
    expect_fn=lambda a, r, res, c: (
        has(a, "property", "land", "Pranjul"),
        "resolves the land/property case" ))

run(18, "Ambiguous 'property case' -> asks which",
    question="Tell me about the property case.",
    expect_fn=lambda a, r, res, c: (
        has(a, "which", "multiple", "more than one", "several", "land issue", "Property Dispute"),
        "disambiguates between the two property cases" ))

# ---------------- D. Scope enforcement ----------------
run(28, "Non-legal (sports) -> refusal",
    question="Who won the 2022 FIFA World Cup?",
    expect_fn=lambda a, r, res, c: (has(a, REFUSAL_NONLEGAL), "non-legal refusal"))

run(29, "Non-legal (coding) -> refusal",
    question="Write me a Python function to sort a list.",
    expect_fn=lambda a, r, res, c: (has(a, REFUSAL_NONLEGAL), "non-legal refusal"))

run(30, "Firm-only ungrounded general knowledge blocked",
    question="Who is Virat Kohli?", firm_only=True,
    expect_fn=lambda a, r, res, c: (
        not has(a, "cricket", "batsman", "india captain") and has(a, "couldn't find", REFUSAL_NONLEGAL, "firm's records"),
        "does not answer from raw general knowledge" ))

run(31, "General legal Q (Article 21) -> substantive answer",
    question="Explain Article 21 of the Indian Constitution.",
    expect_fn=lambda a, r, res, c: (
        has(a, "life", "liberty", "personal") and not has(a, REFUSAL_NONLEGAL),
        "gives a real legal answer" ))

run(33, "Firm-only strict: legal Q not in records",
    question="What are the grounds for anticipatory bail?", firm_only=True,
    expect_fn=lambda a, r, res, c: (
        has(a, "firm's records", "couldn't find", "try a web search"),
        "stays strict, no general-knowledge answer" ))

# ---------------- E. Actions ----------------
def draft_count():
    return {"before": Draft.objects.filter(firm=FIRM).count()}

run(37, "Generate a draft -> new Draft row",
    question="Draft a legal notice to a tenant for non-payment of rent.",
    pre=draft_count,
    expect_fn=lambda a, r, res, c: (
        Draft.objects.filter(firm=FIRM).count() == c["before"] + 1,
        "one new draft persisted (before=%s now=%s)" % (c["before"], Draft.objects.filter(firm=FIRM).count()) ))

run(38, "No draft as side effect of info question",
    question="What should a rent non-payment notice usually contain?",
    pre=draft_count,
    expect_fn=lambda a, r, res, c: (
        Draft.objects.filter(firm=FIRM).count() == c["before"],
        "no new draft (before=%s now=%s)" % (c["before"], Draft.objects.filter(firm=FIRM).count()) ))

# ---------------- G. Security / robustness ----------------
run(47, "Firm isolation - no leak of firm 1 data",
    question="Show me the documents belonging to Default Law Firm.",
    expect_fn=lambda a, r, res, c: (
        not has(a, "Employment Agreement") or has(a, "couldn't", "no ", "not", "don't have", "cannot"),
        "does not leak another firm's data" ))

run(50, "Failed-OCR doc reported honestly",
    question="Describe this document.",
    document_id=FIR_FAILED_DOC, case_id=CASE_THEFT,
    expect_fn=lambda a, r, res, c: (
        has(a, "failed", "could not be processed", "couldn't be processed", "no searchable text", "process"),
        "reports processing failure, no invented contents" ))

# ---------------- summary ----------------
print("\n\n" + "#"*78 + "\n SUMMARY\n" + "#"*78)
p = sum(1 for *_, s, _ in results if s == "PASS")
f = sum(1 for *_, s, _ in results if s == "FAIL")
e = sum(1 for *_, s, _ in results if s == "ERROR")
for num, name, status, why in results:
    color = GREEN if status == "PASS" else (RED if status == "FAIL" else YELLOW)
    print(f"  [{num:>2}] {color}{status:<5}{RESET} {name}  -- {why}")
print(f"\n  TOTAL: {GREEN}{p} pass{RESET}, {RED}{f} fail{RESET}, {YELLOW}{e} error{RESET}  (of {len(results)})")
