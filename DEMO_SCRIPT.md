# Legal AI — Agent Demo Script

A step-by-step walkthrough of the AI agent for a live demo. Four
self-contained demo cases, each showing a different capability of the
tool-calling research agent. Run them **one by one, in order** — later
cases build on the conversational memory from earlier ones.

---

## Before you start (2-minute setup)

1. **Backend running** — in `backend/`:
   ```bash
   source venv/bin/activate
   python manage.py runserver 0.0.0.0:8000
   ```
2. **Frontend running** — in `frontend/`:
   ```bash
   npm run dev
   ```
   Open **http://localhost:3000** and log in.
3. **Sample data is already there.** Every firm is auto-seeded with a
   case called **"Sample Documents"** containing three real legal files:
   - *Sample - Mutual NDA*
   - *Sample - Residential Rental Agreement*
   - *Sample - Employment Agreement*

   If your firm has a few more real cases, even better — the firm-database
   demo (Case 2) looks nicer with 3–5 cases in different statuses.
4. **The Ask-a-Question page** is the main screen. Know these controls:
   - **Answer mode**: 👤 Plain English · 🧾 Mixed · ⚖️ Expert
   - **Document selector** — pick one uploaded document to scope questions to it
   - **Case selector** — pick a case to scope questions to that case's own documents
   - **Web search** — never happens automatically; the agent asks first and
     you click **"Yes, search the web"**

> **One line to explain the agent:** *"Every question goes through one AI
> agent that decides, on its own, which tools to use — search our
> documents, look up a case record, compare two files, draft a document,
> or (only with your permission) search the public web — and it refuses to
> state any fact it can't back up with a real tool result."*

---

## Demo Case 1 — Document Intelligence & Grounded Q&A

**What it proves:** the agent reads an actual uploaded document and answers
strictly from its text — it does not make things up.

**Steps:**
1. Open the **Ask-a-Question** page.
2. In the **document selector**, choose **"Sample - Residential Rental Agreement"**.
3. Set answer mode to **🧾 Mixed**.
4. Ask:
   > **"What is the monthly rent and the notice period for terminating this agreement?"**
5. Show the answer — it pulls the exact figures from the document.
6. Point to the **"Source"** chip / research steps under the answer: it says
   **Uploaded Document**, proving the answer is grounded, not invented.

**Follow-up to show grounding (optional but powerful):**
7. Keep the same document selected and ask:
   > **"Does this agreement mention anything about a company merger?"**
8. The agent answers that this information is **not present** in the
   document — instead of inventing a plausible-sounding clause. **This is
   the anti-hallucination guarantee in action.**

**Talking point:** *"Notice it didn't guess. When the document doesn't say
something, the agent says so plainly."*

---

## Demo Case 2 — Firm Database Q&A + Conversational Memory

**What it proves:** the agent answers questions about the firm's **own
records** straight from the database (never hallucinated), and **remembers
context** so follow-ups work without repeating names.

**Steps:**
1. **Start a new chat** (clear any selected document/case first).
2. Ask a firm-wide question:
   > **"How many open cases do we have?"**
3. Show the answer — an exact count/list from the database, marked
   **Firm Database**.
4. Now a breakdown:
   > **"Break down our cases by type."**
5. Show the categorized answer (civil / criminal / property, etc.).

**The memory moment (the "wow"):**
6. If step 2/4 narrowed things down to **one** specific case, or you now ask
   about a single case by name:
   > **"Tell me about the Sample Documents case."**
7. Then ask a **bare follow-up with no case name**:
   > **"Who is the client and which lawyers are assigned to it?"**
8. The agent answers correctly — it **remembered** which case "it" refers
   to, and it pulled the client/lawyers from the actual case record (the
   `get_case_info` tool), not from a guess.

**Talking point:** *"I never repeated the case name in that last question.
The agent tracked the conversation and knew what 'it' meant — and every
detail came from our real case record."*

---

## Demo Case 3 — AI Drafting (the agent DOES something, not just answers)

**What it proves:** the agent can take an **action** — generating a real
legal draft and saving it to the Drafts page — not only retrieve text.

> Requires a role with drafting permission (admin / partner / associate).

**Steps:**
1. In the chat, ask:
   > **"Draft a formal legal notice to a tenant for non-payment of two months' rent, based on our rental agreement."**
2. The agent generates a complete draft in the chat.
3. Point out the research steps: it shows **"Generated draft: …"**.
4. Open the **Drafts page** — the new draft is saved there as a real record,
   ready to export as **PDF or DOCX**.

**Talking point:** *"This isn't a chatbot answering a question — the agent
performed a task and produced a saved work-product a lawyer can edit and
send."*

**Important guardrail to mention:** the agent only drafts when you
**explicitly ask** it to write/prepare/draft something. It will never
generate a document as a side effect of an informational question.

---

## Demo Case 4 — Anti-Hallucination + Web Search with Consent

**What it proves:** two safety features at once — (a) the agent won't invent
an answer when it has no local source, and (b) it **asks permission**
before ever touching the public internet.

**Steps:**
1. **Start a new chat** (no document, no case selected).
2. Ask something that is NOT in the firm's documents — a current, public
   legal question, e.g.:
   > **"What are the latest Supreme Court guidelines on anticipatory bail?"**
3. Instead of making up an answer, the agent responds that it couldn't find
   this locally and **asks for permission** to search the public web.
4. Click **"Yes, search the web"**.
5. The agent searches trusted legal web sources and answers — now marked
   **Trusted Web Search**, with the sources listed.

**Talking point:** *"Two things happened. First, it didn't fabricate a fake
citation — it admitted it had nothing locally. Second, it did not silently
go to the internet with our data; it asked first. Nothing leaves our
system without a click."*

---

## Quick reference — what each case demonstrates

| # | Demo | Capability shown | Answer source shown |
|---|------|------------------|---------------------|
| 1 | Rental agreement Q&A | Grounded document Q&A + anti-hallucination | Uploaded Document |
| 2 | "How many open cases" → follow-ups | Firm database Q&A + conversational memory | Firm Database |
| 3 | "Draft a legal notice…" | Agent takes an action (drafting) | Draft saved to Drafts page |
| 4 | Anticipatory bail question | Refuses to invent + asks web-search consent | Trusted Web Search |

---

## If something goes wrong during the demo

- **Every question errors with a red "500"** → the Groq free-tier
  **token-per-minute limit** (8000 TPM) is being exceeded. This has been
  reduced in the code, but if it recurs during rapid testing, **wait ~60
  seconds** between questions, or upgrade the Groq account to Dev Tier at
  https://console.groq.com/settings/billing for the live demo.
- **"Document is still being processed"** → wait a few seconds after
  upload; large files chunk/embed in the background.
- **Draft option missing** → your logged-in role doesn't have drafting
  permission; log in as admin/partner/associate.
- **Reset the conversation** between demo cases with **New chat** so old
  context (remembered case) doesn't bleed into the next scenario.

---

*Disclaimer shown on every AI answer: "This is for informational purposes
only and is not legal advice."*
