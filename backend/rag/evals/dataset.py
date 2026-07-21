"""
Golden Q&A set over the three bundled sample documents
(rag/sample_documents/: nda.txt, rental_agreement.txt, employment_agreement.txt).

Every `expected_snippet` is a literal substring of the source document, so
the retrieval-recall metric can check whether the chunk holding the answer
was actually retrieved. `expected_facts` are the ground-truth facts an
answer must state; the correctness judge grades the model's answer against
them. Keep this set small and hand-verified - it is the yardstick, so a
wrong entry here silently corrupts every score.
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional


# Eval-case kinds decide which metrics apply and what "correct" means:
#   answerable         - the answer IS in the named document; graded on
#                        recall + correctness + groundedness.
#   insufficient       - the fact is in NO firm document; the pipeline must
#                        NOT answer it from a document (no fabrication).
#   general_knowledge  - a real legal question with no document answer; the
#                        pipeline should answer from general legal knowledge
#                        (route = llm_knowledge), not claim a document source.
#   not_law            - not a legal question at all; must be turned away.
KIND_ANSWERABLE = "answerable"
KIND_INSUFFICIENT = "insufficient"
KIND_GENERAL_KNOWLEDGE = "general_knowledge"
KIND_NOT_LAW = "not_law"


# Maps a short doc key to the display name seed_sample_documents() gives the
# UploadedDocument row, so the runner can resolve the key to a document_id.
DOC_DISPLAY_NAMES: Dict[str, str] = {
    "nda": "Sample - Mutual NDA.txt",
    "rental": "Sample - Residential Rental Agreement.txt",
    "employment": "Sample - Employment Agreement.txt",
}


@dataclass
class EvalCase:
    id: str
    question: str
    kind: str
    # Document key the question is scoped to (None = firm-wide question,
    # answered via answer_general_question rather than answer_question).
    doc: Optional[str] = None
    expected_snippets: List[str] = field(default_factory=list)
    expected_facts: List[str] = field(default_factory=list)
    # Prior turns for the resumed-session / follow-up cases, in the
    # {"question": ..., "answer": ...} pair shape the pipeline's `history`
    # expects (see groq_client._history_messages).
    history: Optional[List[Dict[str, str]]] = None
    note: str = ""


GOLDEN_CASES: List[EvalCase] = [
    # ---- NDA (answerable) --------------------------------------------------
    EvalCase(
        id="nda-term",
        doc="nda",
        kind=KIND_ANSWERABLE,
        question="How long does this NDA stay in effect?",
        expected_snippets=["three (3) years"],
        expected_facts=["The agreement stays in effect for three (3) years from the Effective Date."],
    ),
    EvalCase(
        id="nda-survival",
        doc="nda",
        kind=KIND_ANSWERABLE,
        question="How long do the confidentiality obligations survive after the agreement ends?",
        expected_snippets=["five (5) years"],
        expected_facts=["Confidentiality obligations survive for five (5) years after termination or expiration."],
    ),
    EvalCase(
        id="nda-jurisdiction",
        doc="nda",
        kind=KIND_ANSWERABLE,
        question="Which courts have jurisdiction over disputes under this NDA?",
        expected_snippets=["exclusive jurisdiction"],
        expected_facts=["The courts at Bengaluru, Karnataka have exclusive jurisdiction."],
    ),
    EvalCase(
        id="nda-parties",
        doc="nda",
        kind=KIND_ANSWERABLE,
        question="Who are the disclosing and receiving parties?",
        expected_snippets=["Vertex Consulting", "Orion Softworks"],
        expected_facts=[
            "Vertex Consulting Pvt. Ltd. is the Disclosing Party.",
            "Orion Softworks LLP is the Receiving Party.",
        ],
    ),
    EvalCase(
        id="nda-termination-notice",
        doc="nda",
        kind=KIND_ANSWERABLE,
        question="What notice is required to terminate the NDA early?",
        expected_snippets=["thirty (30) days"],
        expected_facts=["Either party may terminate early on thirty (30) days' written notice."],
    ),

    # ---- Rental agreement (answerable) ------------------------------------
    EvalCase(
        id="rental-rent",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="What is the monthly rent for the premises?",
        expected_snippets=["35,000"],
        expected_facts=["The monthly rent is Rs. 35,000."],
    ),
    EvalCase(
        id="rental-deposit",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="How much is the security deposit and when is it refunded?",
        expected_snippets=["1,05,000", "thirty (30) days"],
        expected_facts=[
            "The security deposit is Rs. 1,05,000 (three months' rent).",
            "It is refundable within thirty (30) days of vacating the premises.",
        ],
    ),
    EvalCase(
        id="rental-term",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="What is the tenancy period?",
        expected_snippets=["eleven (11) months"],
        expected_facts=["The tenancy is for eleven (11) months, renewable by mutual written consent."],
    ),
    EvalCase(
        id="rental-late-fee",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="Is there a penalty for paying rent late?",
        expected_snippets=["2% of the monthly rent"],
        expected_facts=["A delay beyond seven days attracts a late fee of 2% of the monthly rent per week of delay."],
    ),
    EvalCase(
        id="rental-repairs-cap",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="Who pays for minor repairs, and up to what amount is the tenant responsible?",
        expected_snippets=["Rs. 2,000"],
        expected_facts=[
            "The tenant is responsible for minor repairs up to Rs. 2,000 per instance.",
            "Major structural repairs are the landlord's responsibility.",
        ],
    ),
    # Follow-up: history establishes the rental context, bare-ish follow-up.
    EvalCase(
        id="rental-followup-due-date",
        doc="rental",
        kind=KIND_ANSWERABLE,
        question="And by what date each month must it be paid?",
        history=[
            {
                "question": "What is the monthly rent for the premises?",
                "answer": "The monthly rent is Rs. 35,000, payable in advance.",
            },
        ],
        expected_snippets=["5th day"],
        expected_facts=["Rent is payable on or before the 5th day of each calendar month."],
    ),

    # ---- Employment agreement (answerable) --------------------------------
    EvalCase(
        id="emp-salary",
        doc="employment",
        kind=KIND_ANSWERABLE,
        question="What is the employee's annual salary?",
        expected_snippets=["18,00,000"],
        expected_facts=["The gross annual salary is Rs. 18,00,000 (Eighteen Lakh)."],
    ),
    EvalCase(
        id="emp-probation",
        doc="employment",
        kind=KIND_ANSWERABLE,
        question="What is the probation period and the notice during probation?",
        expected_snippets=["six (6) months", "fifteen (15) days"],
        expected_facts=[
            "Probation is six (6) months from the date of joining.",
            "During probation either party may terminate on fifteen (15) days' written notice.",
        ],
    ),
    EvalCase(
        id="emp-leave",
        doc="employment",
        kind=KIND_ANSWERABLE,
        question="How many days of paid annual leave does the employee get?",
        expected_snippets=["twenty-one (21) days"],
        expected_facts=["The employee is entitled to twenty-one (21) days of paid annual leave."],
    ),
    EvalCase(
        id="emp-noncompete",
        doc="employment",
        kind=KIND_ANSWERABLE,
        question="How long does the non-solicitation restriction last after employment ends?",
        expected_snippets=["twelve (12) months"],
        expected_facts=["The non-solicitation restriction lasts twelve (12) months after employment ends."],
    ),
    EvalCase(
        id="emp-termination-notice",
        doc="employment",
        kind=KIND_ANSWERABLE,
        question="After probation, what notice is needed to terminate employment?",
        expected_snippets=["sixty (60) days"],
        expected_facts=["After probation, termination requires sixty (60) days' written notice or pay in lieu."],
    ),

    # ---- Insufficient: fact is in NO firm document ------------------------
    # The pipeline must not manufacture a document answer for these.
    EvalCase(
        id="insuff-nda-arbitrator",
        doc="nda",
        kind=KIND_INSUFFICIENT,
        question="Who is the arbitrator appointed under this agreement?",
        note="No arbitration clause exists in any sample document.",
    ),
    EvalCase(
        id="insuff-rental-parking",
        doc="rental",
        kind=KIND_INSUFFICIENT,
        question="How many parking spaces are allotted to the tenant?",
        note="Parking is not mentioned in any sample document.",
    ),
    EvalCase(
        id="insuff-emp-gratuity",
        doc="employment",
        kind=KIND_INSUFFICIENT,
        question="What gratuity amount is payable to the employee on resignation?",
        note="Gratuity is not mentioned in any sample document.",
    ),

    # ---- General-knowledge legal question (no document answer) ------------
    EvalCase(
        id="gk-ipc-theft",
        doc=None,
        kind=KIND_GENERAL_KNOWLEDGE,
        question="What is the general punishment for theft under Indian law?",
        note="Legal question with no firm-document answer - should be answered from general knowledge, not a document.",
    ),

    # ---- Not a legal question at all --------------------------------------
    EvalCase(
        id="notlaw-capital",
        doc=None,
        kind=KIND_NOT_LAW,
        question="What is the capital of France?",
    ),
    EvalCase(
        id="notlaw-code",
        doc=None,
        kind=KIND_NOT_LAW,
        question="Write me a Python function that sorts a list of numbers.",
    ),
]
