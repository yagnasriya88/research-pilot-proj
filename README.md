# ResearchPilot

ResearchPilot is an AI research assistant. It helps a person read, search, and understand research papers and books, and it can write research reports on its own.

## Who is this for?

Students, professors, and researchers who read a lot of papers and books for their work or studies. Anyone doing a literature review, writing a thesis, or trying to keep up with new papers in their field.

## What problem are we solving?

Reading research papers takes a long time. A student may need to read 20-30 papers just to write one literature review. Finding the right papers, reading them, pulling out the key points, and comparing them across papers is slow and repetitive work. Most tools only do one small piece of this (search, or PDF reading, or notes) — not the whole flow.

## Our angle

Most "chat with PDF" tools stop at one file. ResearchPilot treats the whole research workflow as one connected system:

- Search for papers (arXiv, Semantic Scholar, or your own library) and chat with the results.
- Chat with one paper, many papers, or a whole folder at once — the same chat can pull answers from many sources, not just one file.
- A "Deep Research" mode that plans a search, screens the results, pulls out facts, and writes a full report on its own — like a mini research agent, not just a chatbot.
- Read the actual PDF in the browser, highlight text, select any passage or even a picture/diagram and ask AI about just that part.
- Books are treated differently from papers — a 300-page book needs different reading and search logic than a 10-page paper, so books get their own smarter retrieval that can jump across chapters to answer a question.
- Every chat, search, and report is saved and organized in one place ("My Chats"), so past research is never lost.

## Why this matters

Research is slow work, and AI can remove the boring parts (searching, re-reading, summarizing) so the person can spend time thinking, not scrolling. This helps students finish assignments faster, helps researchers stay on top of new papers, and helps anyone writing a paper or report gather sources faster.

## Feasibility

Built for a hackathon timeframe by keeping scope realistic:
- One shared login-gated workspace, not a full multi-user system with permissions.
- Core building blocks (PDF reading, chat, search) were built first, then reused across features instead of building each feature from scratch.
- Deep Research is explicitly its own separate agent type (not the default chat flow), so its extra cost/latency is opt-in per query, not something every chat pays for.

## Where the data comes from

- **Papers and books** — uploaded by the user, or fetched live from public research APIs: **arXiv** and **Semantic Scholar**.
- **Chat answers** — generated live by OpenAI's models, grounded in the actual text of the papers/books (not made up from memory).
- **Deep Research reports** — built live by OpenAI's own autonomous web-research agent at the time of the question.
- No fixed offline dataset is used — everything is fetched or uploaded live, so results are always current.

## Agentic architecture

ResearchPilot uses agents in two places:

1. **Deep Research report** — runs in one of two selectable modes (Standard by default, Deeper Search opt-in):
   - **Standard** — a 5-stage pipeline (plan → search → screen → extract → synthesize) over arXiv and Semantic Scholar. To keep the report grounded in real paper content rather than just short abstracts, it enriches candidates with deeper context: papers from the user's own library get a real vector search against their full text, and external candidates get their actual PDF fetched and extracted where possible. Free and fast, with no external rate limits.
   - **Deeper Search** — the question is first expanded into a detailed research brief, then handed to OpenAI's own autonomous web-research agent (`o4-mini-deep-research`), which plans its own searches, browses the web, and synthesizes a full cited report end to end — a single real run does 15-20+ sequential web searches before it's done. More thorough, but slower and subject to OpenAI's own rate limits.
   
   Both modes are instructed to answer strictly from peer-reviewed/academic sources, and both persist a real error message if generation fails rather than leaving the chat looking stuck.
2. **Book chat** — instead of doing one fixed search, the AI is given a search tool and decides for itself when to use it. This means a question about one chapter can pull in facts from a different chapter automatically, without the user having to search manually.

This split adds real value, not just complexity: Deep Research offloads open-web planning/search/screening to a purpose-built research agent instead of reimplementing it, and the book agent gives better answers on long documents than a single fixed search ever could.

## How the user benefits

- Saves hours of manual reading and searching.
- Gets answers backed by the real text of the paper/book, with page/section references — not guesses.
- Can go from "find papers on X" to a written, cited report in one flow, instead of jumping between five different tools.
- Can highlight, take notes, and ask questions on the exact passage or diagram they're looking at, right inside the PDF.
- Never loses past research — every chat, search, and report is saved and searchable later.

## Tech stack

- **Backend:** Python, FastAPI, MongoDB Atlas (with Atlas Vector Search), OpenAI API, PyMuPDF, LlamaIndex (books pipeline only).
- **Frontend:** React, TypeScript, Vite, react-pdf, Tiptap.
- **Auth:** JWT login wall (bcrypt + PyJWT) — one shared workspace, not per-user data separation.

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
cp .env.example .env       # then fill in MONGODB_URI, OPENAI_API_KEY, SECRET_KEY
uvicorn app.main:app --reload
```

The backend runs at `http://localhost:8000`. On first startup it creates regular Mongo
indexes and attempts to create the Atlas Vector Search indexes for papers and books — this
only succeeds against a real Atlas cluster; it logs a warning and continues otherwise (you
won't get retrieval without it).

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api/*` to the backend at
`http://localhost:8000` (see `vite.config.ts`).

## Trying it out

1. Sign up for an account (login is required to use the app — one shared workspace for all
   logged-in users).
2. Open **Reference Manager** and add a paper — **Upload File**, **Upload URL or DOI**, or
   **Add Manually**. Wait for its status badge to go from pending to ready.
3. Go to the **Dashboard**, pick an agent (AI Search, Chat with PDF, or Deep Research Report),
   choose a source scope, and ask a question.
4. Open a paper or book in the **Reader** to highlight text, select a passage or image region,
   and ask AI about just that part.
5. Check **My Chats** for full conversation history and **My Notebooks** for saved notes.

## Notes

- Login is a wall, not multi-tenancy — every logged-in user shares the same papers, chats,
  notebooks, and books.
- PDFs and captured image crops are stored in MongoDB via GridFS (`app/services/storage.py`),
  not on local disk — this survives redeploys/restarts on hosts with an ephemeral filesystem
  (e.g. Render's free/standard web services). See `deployment.md` for production deployment
  notes (Vercel + Render).
