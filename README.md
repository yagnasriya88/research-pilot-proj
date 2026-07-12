# Research Pilot (Phase 1)

A portfolio clone of paperguide.ai. Phase 1 covers: Dashboard, Reference Manager, Chat with
PDF (multi-document RAG), My Chats, and My Notebooks. See `.claude/PLAN.MD` for the roadmap
and `docs/paperguide-analysis.md` for the research behind the design choices.

## Prerequisites

- Python 3.11+
- Node 20+
- A MongoDB Atlas cluster (free tier is fine — Atlas Vector Search requires Atlas, not a
  local/self-hosted MongoDB)
- An OpenAI API key

## Backend setup

```bash
cd backend
python -m venv .venv
./.venv/Scripts/activate   # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env       # then fill in MONGODB_URI and OPENAI_API_KEY
uvicorn app.main:app --reload
```

The backend runs at `http://localhost:8000`. On first startup it creates regular Mongo
indexes and attempts to create the Atlas Vector Search index on `paper_chunks` — this only
succeeds against a real Atlas cluster; it logs a warning and continues otherwise (you won't
get RAG retrieval without it).

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api/*` to the backend at
`http://localhost:8000` (see `vite.config.ts`).

## Trying it out

1. Open `http://localhost:5173/references` (Reference Manager) and add a paper — either
   **Upload File** (a real PDF), **Upload URL or DOI** (a DOI will be resolved via Crossref;
   an open-access PDF is fetched via Unpaywall if available), or **Add Manually** (metadata
   only, no chat available).
2. Wait a few seconds for ingestion (`ingestionStatus` badge on the paper row goes from
   pending → PDF/ready).
3. Go to the Dashboard, type a question, click "Choose References" and pick the paper(s)
   you just added, then submit — this creates a new Chat with PDF conversation and asks
   your question.
4. Try the quick-action buttons (Summarize, Compare key claims, etc.) and freeform
   follow-ups. Add more sources via "+ Add File" to test multi-document questions.
5. Use "Save to Notebook" on a chat to see it show up under **My Notebooks**, and check
   **My Chats** for the full conversation history.

## Notes

- No authentication — everything is a single shared workspace, by design for this phase.
- PDFs are stored on local disk under `backend/data/pdfs` (path configurable via
  `PDF_STORAGE_DIR` in `.env`).
- If a paper's PDF is short enough (see `FULL_TEXT_FALLBACK_TOKEN_THRESHOLD` in `.env`) and
  few enough papers are selected, the RAG pipeline uses the full text instead of chunk
  retrieval for that paper — otherwise it falls back to per-paper top-k vector search.