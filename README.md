# Legal AI

A multi-tenant AI platform for law firms — document intelligence, firm database Q&A, case management, and a personalized AI legal assistant, built on a Django backend, Next.js frontend, ChromaDB vector store, and Groq-hosted LLMs.

## What it does

- **Document intelligence** — upload PDFs, DOCX, PPTX, images, and scanned documents (OCR via Tesseract), then summarize, extract structured entities, analyze risk, check compliance, or compare documents. Answers are always grounded in the actual retrieved text, never invented.
- **Streaming AI chat (tool-first)** — every message goes through an intent-detection layer, then either a direct streamed answer or a bounded LLM tool-calling loop. Answers stream over SSE (`POST /api/chat/stream/`) with live tool/status events feeding the sources panel.
- **Dual RAG** —
  - *Knowledge Base RAG*: per-firm isolated Chroma collections over uploaded documents (hard multi-tenant boundary, hybrid vector + exact-keyword retrieval, no relevance thresholds — the model judges match distances itself).
  - *Memory RAG*: per-user memory collections built from distilled conversation takeaways, thumbs-down feedback, and corrections; retrieved every turn plus a standing per-user style profile, so answers adapt to each user's tone and preferences over time.
- **Modular tool registry** — tools are single decorated functions (`backend/chat/tools/`): document search, trusted-domain web search, similar-case search (semantic case index), case details, in-app case deep links, firm overview, form details, document compare, and draft generation. Role permissions gate which tools each user's model even sees; adding a tool never touches the pipeline.
- **Feedback loop** — thumbs up/down (with optional comment) on every AI answer; negative feedback becomes memory that shapes future answers.
- **Case management** — cases, reminders, contacts, assigned lawyers, and an auto-logged case activity feed, all firm-scoped.
- **AI drafting** — generate legal drafts and redline suggestions from a prompt, with case linking and PDF/DOCX export.
- **Forms library** — firm-scoped legal/court form records (code, jurisdiction, required fields, submission link) served to the assistant through the form-details tool.
- **Role-based access control** — admin / partner / associate / paralegal / public roles, each with a distinct permission set, enforced firm-wide.
- **Google Drive sync** — optional per-firm Drive folder indexing.

## Architecture

```
backend/    Django 5 + django-ninja REST API
  accounts/   Firms, lawyers, auth (JWT), roles/permissions, Google Drive integration
  api/        Document upload/processing, chat session/message models + endpoints
  cases/      Cases, reminders, contacts, case activity feed
  drafts/     AI drafting, redlining, PDF/DOCX export
  legalforms/ Legal/court form records + CRUD
  chat/       The AI chatbot module (isolated):
                orchestrator.py  one turn: intent -> tools -> streamed answer -> persist -> learn
                intent.py        fast-model intent detection (tools vs direct, correction capture)
                tools/           decorator-based tool registry + all tools
                memory/          Memory RAG: store (per-user Chroma), writer, style profile
                prompts/         system/intent/memory prompts + shared fragments
                api.py           SSE stream endpoint + feedback endpoints
  rag/        Shared retrieval/ingestion library: vector store, embeddings, chunking,
              document processing/OCR, web search, drafting, evals

frontend/   Next.js (App Router) + React 19 + Tailwind
              lib/chatStream.ts             fetch/ReadableStream SSE client
              components/chat/FeedbackButtons.tsx
```

**LLMs**: `llama-3.3-70b-versatile` (Groq) for the tool loop, answers, and drafting; `llama-3.1-8b-instant` (`GROQ_FAST_MODEL`) for intent detection, memory extraction, and style summarization. Per-firm API key/model overrides supported.

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
python manage.py test api chat
python manage.py run_evals        # live golden-case eval gate (needs GROQ_API_KEY)
```

## Notes

- `backend/vector_db/`, `backend/media/`, and `backend/db.sqlite3` are gitignored — they're generated/runtime data, not source. A fresh clone starts with an empty vector store and database (`migrate` creates the schema).
- The chat pipeline has no hardcoded routing regexes, distance thresholds, or chat rate limits — behavior comes from LLM reasoning over tools, dual-RAG retrieval, and per-user memory.
