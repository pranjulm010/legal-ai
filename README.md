# Legal AI

A multi-tenant AI platform for law firms — document intelligence, firm database Q&A, case management, and an AI drafting/research agent, built on a Django backend, Next.js frontend, ChromaDB vector store, and Groq-hosted LLMs.

## What it does

- **Document intelligence** — upload PDFs, DOCX, PPTX, images, and scanned documents (OCR via Tesseract), then summarize, extract structured entities, analyze risk, check compliance, or compare documents. Answers are always grounded in the actual retrieved text, never invented.
- **Retrieval-augmented Q&A** — ask questions about an uploaded document or across a firm's whole document collection. Per-firm isolated vector collections (Chroma) enforce a hard multi-tenant boundary, not just a metadata filter.
- **Firm database Q&A** — natural-language questions about the firm's own operational data ("how many open cases", "who is on my team", "list my drafts") are answered directly from the database, with an LLM intent classifier as a general fallback so phrasing/synonyms/language don't need to be hardcoded.
- **Conversational memory** — the agent tracks which case or collection of records a conversation has narrowed down to, so follow-ups ("what is it about?", "who is the client?", "what are they?") resolve without re-asking for an identifier, while still asking for clarification when the reference is genuinely ambiguous.
- **Case management** — cases, reminders, contacts, assigned lawyers, and an auto-logged case activity feed, all firm-scoped.
- **AI drafting** — generate legal drafts and redline suggestions from a prompt, with case linking and PDF/DOCX export.
- **Tool-calling research agent** — a single agent (mandatory for every query) that can search documents, look up case records, compare documents, generate drafts, and search the public web (only with explicit consent), with anti-hallucination guardrails, a self-reflection check, and persistent cross-session "lessons learned" from caught mistakes.
- **Role-based access control** — admin / partner / associate / paralegal / public roles, each with a distinct permission set, enforced firm-wide.
- **Google Drive sync** — optional per-firm Drive folder indexing.

## Architecture

```
backend/    Django 5 + django-ninja REST API
  accounts/   Firms, lawyers, auth (JWT), roles/permissions, Google Drive integration
  api/        Document upload/processing, chat sessions, ask-question endpoint
  cases/      Cases, reminders, contacts, case activity feed
  drafts/     AI drafting, redlining, PDF/DOCX export
  rag/        RAG pipeline, vector store, document processing/OCR, the tool-calling agent,
              firm-stats intent classification, web search

frontend/   Next.js (App Router) + React 19 + Tailwind
```

**LLMs**: `llama-3.3-70b-versatile` (Groq) for RAG answers, drafting, classification, and reflection; a separate `openai/gpt-oss-120b` (Groq) used only for the agent's multi-tool selection, since the primary model proved unreliable at choosing between 2+ simultaneous tools.

**Embeddings**: `sentence-transformers/all-MiniLM-L6-v2`, run locally (no external API call, no quota).

## Getting started

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and fill in real values (never commit `.env` — it's gitignored):

```bash
cp .env.example .env
```

Tesseract OCR must be installed separately and its path set in `rag/document_processor.py` (`pytesseract.pytesseract.tesseract_cmd`).

```bash
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

### Frontend

```bash
cd frontend
npm install
```

Copy `frontend/.env.local.example` to `frontend/.env.local`:

```bash
cp .env.local.example .env.local
```

```bash
npm run dev
```

Visit `http://localhost:3000`.

### Running tests

```bash
cd backend
python manage.py test api.tests rag.tests
```

## Notes

- `backend/vector_db/`, `backend/media/`, and `backend/db.sqlite3` are gitignored — they're generated/runtime data, not source. A fresh clone starts with an empty vector store and database (`migrate` creates the schema).
- The tool-calling agent is the default path for every question; there is no separate "basic" mode.
