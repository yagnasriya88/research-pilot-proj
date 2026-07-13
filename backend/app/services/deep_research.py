import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass

from bson import ObjectId
from openai import AsyncOpenAI

from app.config import settings
from app.db.mongo import chats, paper_chunks, papers
from app.models.chat import DeepResearchScope
from app.models.common import utcnow
from app.services.ingestion import download_bytes, embed_texts, extract_pages
from app.services.rag import _paper_vector_search
from app.services.search_providers import (
    NormalizedResult,
    ProviderStatus,
    dedupe_and_rank,
    run_search_with_status,
)

logger = logging.getLogger(__name__)

_openai = AsyncOpenAI(api_key=settings.openai_api_key)

# Beyond a plain abstract stub, a candidate's context can be enriched with real text (either a
# paper-scoped vector-search hit for folder-sourced candidates, or extracted PDF text for
# external ones) — this caps how much of that richer text reaches the extraction prompt so a
# full pipeline run (up to `deep_research_screen_keep` candidates) still fits comfortably in
# one LLM call.
ENRICHED_CONTEXT_CHARS = 5000


@dataclass
class Candidate:
    title: str
    authors: list[str]
    year: int | None
    venue: str | None
    abstract: str
    citationCount: int | None
    doi: str | None
    url: str | None
    pdfUrl: str | None
    paperId: str | None  # set when sourced from the user's own library
    keyFindings: str = ""
    methodology: str = ""
    limitations: str = ""


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _persist_stage(chat_id: str, stages: list[dict]) -> None:
    await chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {"deepResearchStages": stages}})


async def _persist_final_report(chat_id: str, narration: str, markdown: str, references: list[dict]) -> dict:
    output = {"kind": "document", "markdown": markdown, "references": references}
    assistant_message = {"role": "assistant", "content": narration, "output": output}
    await chats.update_one(
        {"_id": ObjectId(chat_id)},
        {"$push": {"messages": assistant_message}, "$set": {"updatedAt": utcnow()}},
    )
    return output


async def _persist_error(chat_id: str, message: str) -> None:
    """On failure, push a real assistant message instead of leaving the chat silently
    stuck on its last "running" stage forever — a client that reconnects later (or polls,
    since it has no live SSE connection to the original run) needs something to see.
    """
    await chats.update_one(
        {"_id": ObjectId(chat_id)},
        {"$push": {"messages": {"role": "assistant", "content": message}}, "$set": {"updatedAt": utcnow()}},
    )


async def _llm_json(system_prompt: str, user_content: str) -> dict:
    response = await _openai.chat.completions.create(
        model=settings.chat_model,
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": user_content}],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


async def _stage_plan(query: str) -> list[str]:
    result = await _llm_json(
        "You help plan literature research. Given a research question, produce 2-4 "
        'distinct search queries that together would surface the most relevant academic '
        'literature. Respond as JSON: {"subQueries": ["...", ...]}.',
        query,
    )
    sub_queries = result.get("subQueries") or []
    return [query] + [q for q in sub_queries if q and q != query]


def _summarize_provider_statuses(all_statuses: list[list[ProviderStatus]]) -> str:
    """Aggregates the per-sub-query ProviderStatus lists collected across a search stage into
    one detail string, e.g. "arXiv: 12 match(es); Semantic Scholar: unavailable (timeout)".
    A provider counts as unavailable if it failed on *any* sub-query call (a mid-run failure is
    itself worth surfacing even if an earlier call succeeded); otherwise its match count is
    summed across calls.
    """
    by_provider: dict[str, list[ProviderStatus]] = {}
    for statuses in all_statuses:
        for s in statuses:
            by_provider.setdefault(s.name, []).append(s)

    labels = {"arxiv": "arXiv", "semantic_scholar": "Semantic Scholar"}
    parts = []
    for name, statuses in by_provider.items():
        label = labels.get(name, name)
        failed = [s for s in statuses if not s.ok]
        if failed:
            parts.append(f"{label}: unavailable ({failed[0].error or 'error'})")
        else:
            parts.append(f"{label}: {sum(s.result_count for s in statuses)} match(es)")
    return "; ".join(parts)


async def _stage_search_external(
    sub_queries: list[str], providers: list[str] | None = None
) -> tuple[list[Candidate], str]:
    result_lists: list[list[NormalizedResult]] = []
    all_statuses: list[list[ProviderStatus]] = []
    for sub_query in sub_queries:
        results, statuses = await run_search_with_status(sub_query, limit=10, providers=providers)
        result_lists.append(results)
        all_statuses.append(statuses)
    merged = dedupe_and_rank(*result_lists)
    candidates = [
        Candidate(
            title=r.title,
            authors=r.authors,
            year=r.year,
            venue=r.venue,
            abstract=r.abstract or "No abstract available.",
            citationCount=r.citationCount,
            doi=r.doi,
            url=r.url or r.pdfUrl,
            pdfUrl=r.pdfUrl,
            paperId=None,
        )
        for r in merged
    ]
    return candidates, _summarize_provider_statuses(all_statuses)


async def _stage_load_folder(folder_id: str, query: str) -> list[Candidate]:
    docs = await papers.find({"folderId": ObjectId(folder_id)}).to_list(length=500)
    query_embedding: list[float] | None = None
    candidates = []
    for doc in docs:
        abstract = doc.get("abstract")
        if not abstract and doc.get("ingestionStatus") == "ready":
            try:
                if query_embedding is None:
                    [query_embedding] = await embed_texts([query])
                chunks = await _paper_vector_search(doc["_id"], query_embedding, top_k=5)
            except Exception:
                logger.warning("Deep research folder vector search failed for paper %s", doc["_id"], exc_info=True)
                chunks = []
            if chunks:
                abstract = "\n\n".join(c["text"] for c in chunks)[:ENRICHED_CONTEXT_CHARS]
            else:
                first_chunk = await paper_chunks.find_one({"paperId": doc["_id"], "chunkIndex": 0})
                if first_chunk:
                    abstract = first_chunk["text"][:1500]
        candidates.append(
            Candidate(
                title=doc.get("title", "Untitled"),
                authors=doc.get("authors", []),
                year=doc.get("year"),
                venue=doc.get("venue"),
                abstract=abstract or "No abstract or excerpt available for this paper.",
                citationCount=doc.get("citationCount"),
                doi=doc.get("doi"),
                url=None,
                pdfUrl=None,
                paperId=str(doc["_id"]),
            )
        )
    return candidates


def _numbered_listing(candidates: list[Candidate], abstract_chars: int = 4000) -> str:
    return "\n\n".join(
        f"[{i + 1}] {c.title} ({c.year or 'n.d.'}) - {c.citationCount or 0} citations\n"
        f"{c.abstract[:abstract_chars]}"
        for i, c in enumerate(candidates)
    )


async def _stage_screen(query: str, candidates: list[Candidate]) -> list[Candidate]:
    if len(candidates) <= settings.deep_research_screen_keep:
        return candidates
    try:
        result = await _llm_json(
            "You screen candidate papers for relevance and quality for a research report. "
            f'Given the research question and numbered candidates, pick the best '
            f"{settings.deep_research_screen_keep} to keep. Respond as JSON: "
            '{"keep": [<1-indexed numbers>]}.',
            f"Question: {query}\n\nCandidates:\n\n{_numbered_listing(candidates, abstract_chars=600)}",
        )
        keep_indices = [i - 1 for i in result.get("keep", []) if 0 < i <= len(candidates)]
        if keep_indices:
            return [candidates[i] for i in keep_indices[: settings.deep_research_screen_keep]]
    except Exception:
        logger.warning("Deep research screening failed, falling back to top-N", exc_info=True)
    return candidates[: settings.deep_research_screen_keep]


async def _fetch_external_full_text(candidate: Candidate) -> None:
    """Best-effort: replace a candidate's short provider abstract with real extracted PDF
    text when a PDF is actually fetchable. Never raises — any failure (no URL, network error,
    non-PDF response, unparseable PDF) just leaves the existing abstract in place.
    """
    if not candidate.pdfUrl:
        return
    try:
        pdf_bytes = await download_bytes(candidate.pdfUrl)
        if not pdf_bytes:
            return
        pages = extract_pages(pdf_bytes)
        text = "\n\n".join(pages).strip()
        if text:
            candidate.abstract = text[:ENRICHED_CONTEXT_CHARS]
    except Exception:
        logger.warning("Deep research full-text fetch failed for %s", candidate.pdfUrl, exc_info=True)


async def _enrich_external_candidates(candidates: list[Candidate]) -> None:
    await asyncio.gather(*(_fetch_external_full_text(c) for c in candidates if c.paperId is None))


async def _stage_extract(query: str, candidates: list[Candidate]) -> list[Candidate]:
    await _enrich_external_candidates(candidates)
    try:
        result = await _llm_json(
            "You extract structured findings from paper excerpts for a research report. "
            "For each numbered paper, extract its key findings, methodology, and "
            'limitations (1-2 sentences each). Respond as JSON: {"papers": [{"index": '
            '<1-indexed>, "keyFindings": "...", "methodology": "...", "limitations": '
            '"..."}]}.',
            f"Question: {query}\n\nPapers:\n\n{_numbered_listing(candidates)}",
        )
        by_index = {item["index"]: item for item in result.get("papers", [])}
        for i, candidate in enumerate(candidates):
            extracted = by_index.get(i + 1)
            if extracted:
                candidate.keyFindings = extracted.get("keyFindings", "")
                candidate.methodology = extracted.get("methodology", "")
                candidate.limitations = extracted.get("limitations", "")
    except Exception:
        logger.warning("Deep research extraction failed, continuing with abstracts only", exc_info=True)
    return candidates


SYNTHESIZE_SYSTEM_PROMPT = """You are a research assistant writing a Deep Research Report.
Using ONLY the extracted findings provided, write a comprehensive Markdown report with
these sections in order: Executive Summary, Introduction, Problem Definition, Background,
Current State of Research, Comparison of Existing Methods, Advantages, Limitations,
Research Gaps, Future Research, Conclusion, References.

Cite papers inline using their bracketed number, e.g. [1], [3]. The References section must
list every numbered paper with its title, authors, and year. Do not fabricate information
beyond what's given. Always use $...$ for inline math and $$...$$ for display math. Never use
\\( \\) or \\[ \\] delimiters."""


async def _stage_synthesize(query: str, candidates: list[Candidate]) -> str:
    listing = "\n\n".join(
        f"[{i + 1}] {c.title} ({c.year or 'n.d.'}) by {', '.join(c.authors[:3]) or 'Unknown'}\n"
        f"Key findings: {c.keyFindings or c.abstract[:300]}\n"
        f"Methodology: {c.methodology or 'Not specified'}\n"
        f"Limitations: {c.limitations or 'Not specified'}"
        for i, c in enumerate(candidates)
    )
    response = await _openai.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": SYNTHESIZE_SYSTEM_PROMPT},
            {"role": "user", "content": f"Research question: {query}\n\nExtracted papers:\n\n{listing}"},
        ],
    )
    return response.choices[0].message.content


def _references_list(candidates: list[Candidate]) -> list[dict]:
    return [
        {
            "index": i + 1,
            "title": c.title,
            "authors": c.authors,
            "year": c.year,
            "url": c.url,
            "paperId": c.paperId,
        }
        for i, c in enumerate(candidates)
    ]


def _no_candidates_report(query: str, scope: DeepResearchScope, detail_suffix: str) -> str:
    if scope == DeepResearchScope.arxiv:
        suggestion = 'Try switching to the "All Papers" scope, which also searches Semantic Scholar.'
    elif scope == DeepResearchScope.folder:
        suggestion = "Check that the selected folder actually contains papers, or try a broader scope."
    else:
        suggestion = "Try rephrasing your question with different terms."
    reason = f" ({detail_suffix})" if detail_suffix else ""
    return (
        f"# No relevant papers found\n\n"
        f"No candidate papers were found for **{query}** under the current scope{reason}.\n\n"
        f"{suggestion}"
    )


async def run_pipeline(
    chat_id: str, query: str, scope: DeepResearchScope, folder_id: str | None
) -> AsyncGenerator[str, None]:
    stages = [
        {"name": "plan", "status": "pending"},
        {"name": "search", "status": "pending"},
        {"name": "screen", "status": "pending"},
        {"name": "extract", "status": "pending"},
        {"name": "synthesize", "status": "pending"},
    ]

    async def set_stage(name: str, status: str, detail: str = "") -> str:
        for s in stages:
            if s["name"] == name:
                s["status"] = status
                s["detail"] = detail
        await _persist_stage(chat_id, stages)
        return _sse({"stage": name, "status": status, "detail": detail})

    def fail_current_stage() -> None:
        for s in stages:
            if s["status"] == "running":
                s["status"] = "failed"

    try:
        yield await set_stage("plan", "running")
        sub_queries = await _stage_plan(query)
        yield await set_stage("plan", "done", f"{len(sub_queries)} search angle(s) identified")

        yield await set_stage("search", "running")
        detail_suffix = ""
        if scope == DeepResearchScope.folder:
            candidates = await _stage_load_folder(folder_id, query) if folder_id else []
        else:
            providers = ["arxiv"] if scope == DeepResearchScope.arxiv else None
            candidates, detail_suffix = await _stage_search_external(sub_queries, providers=providers)
        search_detail = f"{len(candidates)} candidate paper(s) found"
        if detail_suffix:
            search_detail += f" — {detail_suffix}"
        yield await set_stage("search", "done", search_detail)

        if len(candidates) < settings.deep_research_min_candidates:
            for name in ("screen", "extract", "synthesize"):
                yield await set_stage(name, "done", "Skipped — no candidates found")
            markdown = _no_candidates_report(query, scope, detail_suffix)
            narration = "No relevant papers were found for this query."
            output = await _persist_final_report(chat_id, narration, markdown, references=[])
            yield _sse({"done": True, "content": narration, "output": output})
            return

        yield await set_stage("screen", "running")
        candidates = await _stage_screen(query, candidates)
        yield await set_stage("screen", "done", f"{len(candidates)} paper(s) kept")

        yield await set_stage("extract", "running", "Fetching full text & extracting findings…")
        candidates = await _stage_extract(query, candidates)
        yield await set_stage("extract", "done", "Findings extracted")

        yield await set_stage("synthesize", "running")
        markdown = await _stage_synthesize(query, candidates)
        yield await set_stage("synthesize", "done", "Report written")

        references = _references_list(candidates)
        narration = f"Generated a Deep Research Report covering {len(candidates)} papers."
        output = await _persist_final_report(chat_id, narration, markdown, references)
        yield _sse({"done": True, "content": narration, "output": output})
    except Exception:
        logger.exception("Deep research pipeline failed for chat %s", chat_id)
        fail_current_stage()
        await _persist_stage(chat_id, stages)
        error_message = "Report generation failed. Please try again."
        await _persist_error(chat_id, error_message)
        yield _sse({"error": error_message})


QUERY_EXPANSION_SYSTEM_PROMPT = f"""You turn a user's research question into a detailed
research brief for an autonomous research agent. Clarify the scope, list the key sub-questions
a thorough answer should cover, and note any implicit constraints. The brief must explicitly
instruct the agent to:
- Only use peer-reviewed journal articles, conference papers, and recognized academic preprint
  archives (e.g. arXiv, PubMed, IEEE Xplore, ACM Digital Library, Nature, Science, JSTOR,
  Google Scholar, university/research-institution publications) as sources. Blogs, news
  articles, marketing pages, and general web content must never be used or cited, even as
  supporting context.
- Cite every claim with its source paper, preferring primary research over secondary summaries
  or review articles when possible.
- Explicitly flag when no academic paper was found for a sub-question, rather than silently
  substituting a non-academic source.
- Use at most {settings.deep_research_openai_max_sources} total sources and stop searching once
  that many strong sources are found, prioritizing the most relevant/highly-cited work over
  exhaustive coverage.
Respond with the brief as plain text (no preamble, no JSON, no markdown headers) - it will be
passed directly to the research agent as its instructions."""


DEEP_RESEARCH_INSTRUCTIONS = f"""You are a research assistant producing a Deep Research Report.

Only use peer-reviewed journal articles, conference papers, and recognized academic preprint
archives (e.g. arXiv, PubMed, IEEE Xplore, ACM Digital Library, Nature, Science, JSTOR, Google
Scholar, university/research-institution publications) as sources. Never cite or rely on blogs,
news articles, marketing pages, or general web content, even as supporting context — if no
academic source exists for a sub-question, say so explicitly rather than substituting one.

Use at most {settings.deep_research_openai_max_sources} total sources. Stop searching once you
have that many strong, relevant sources rather than exhaustively continuing — prioritize
quality and relevance over quantity of searches.

Write the report in Markdown with these sections in order: Executive Summary, Introduction,
Problem Definition, Background, Current State of Research, Comparison of Existing Methods,
Advantages, Limitations, Research Gaps, Future Research, Conclusion, References. Cite papers
inline using their bracketed reference number, e.g. [1], [3], and list every numbered source
with its title, authors, year, and URL in the References section. Always use $...$ for inline
math and $$...$$ for display math. Never use \\( \\) or \\[ \\] delimiters."""


async def _expand_query_for_deep_research(query: str) -> str:
    response = await _openai.chat.completions.create(
        model=settings.chat_model,
        messages=[
            {"role": "system", "content": QUERY_EXPANSION_SYSTEM_PROMPT},
            {"role": "user", "content": query},
        ],
    )
    return response.choices[0].message.content


RESEARCH_STAGE_DETAIL = {
    "response.web_search_call.in_progress": "Preparing a web search…",
    "response.web_search_call.searching": "Searching the web…",
    "response.web_search_call.completed": "Reviewed search results",
}


def _openai_references_list(response) -> list[dict]:
    """Derives the reference list from the `web_search_preview` tool's citation annotations —
    `o4-mini-deep-research` does not support structured/JSON-schema output (confirmed via the
    API: `text.format` of type `json_schema` is rejected for this model), so annotation
    citations are the only mechanism available for getting real source URLs out of this model.
    """
    seen_urls: set[str] = set()
    references: list[dict] = []
    for item in response.output:
        if getattr(item, "type", None) != "message":
            continue
        for content in getattr(item, "content", []):
            for annotation in getattr(content, "annotations", None) or []:
                if getattr(annotation, "type", None) != "url_citation" or annotation.url in seen_urls:
                    continue
                seen_urls.add(annotation.url)
                references.append(
                    {
                        "index": len(references) + 1,
                        "title": annotation.title,
                        "authors": [],
                        "year": None,
                        "url": annotation.url,
                        "paperId": None,
                    }
                )
    return references


async def run_deep_research(chat_id: str, query: str) -> AsyncGenerator[str, None]:
    stages = [
        {"name": "planning", "status": "pending"},
        {"name": "research", "status": "pending"},
    ]

    async def set_stage(name: str, status: str, detail: str = "") -> str:
        for s in stages:
            if s["name"] == name:
                s["status"] = status
                s["detail"] = detail
        await _persist_stage(chat_id, stages)
        return _sse({"stage": name, "status": status, "detail": detail})

    def fail_current_stage() -> None:
        for s in stages:
            if s["status"] == "running":
                s["status"] = "failed"

    try:
        yield await set_stage("planning", "running", "Expanding your question into a research brief…")
        brief = await _expand_query_for_deep_research(query)
        yield await set_stage("planning", "done", brief)

        yield await set_stage("research", "running", "Starting deep research…")
        stream = await _openai.responses.create(
            model=settings.deep_research_openai_model,
            instructions=DEEP_RESEARCH_INSTRUCTIONS,
            input=brief,
            background=True,
            stream=True,
            tools=[{"type": "web_search_preview"}],
        )

        final_response = None
        async for event in stream:
            detail = RESEARCH_STAGE_DETAIL.get(event.type)
            if detail:
                yield await set_stage("research", "running", detail)
            elif event.type == "response.completed":
                final_response = event.response
            elif event.type == "response.failed":
                raise RuntimeError(f"Deep research response failed: {event.response.error}")

        if final_response is None:
            raise RuntimeError("Deep research stream ended without a completed response")

        markdown = final_response.output_text
        references = _openai_references_list(final_response)
        yield await set_stage("research", "done", f"{len(references)} source(s) cited")

        narration = f"Generated a Deep Research Report covering {len(references)} source(s)."
        output = await _persist_final_report(chat_id, narration, markdown, references)
        yield _sse({"done": True, "content": narration, "output": output})
    except Exception:
        logger.exception("Deep research pipeline failed for chat %s", chat_id)
        fail_current_stage()
        await _persist_stage(chat_id, stages)
        error_message = "Report generation failed. Please try again."
        await _persist_error(chat_id, error_message)
        yield _sse({"error": error_message})
