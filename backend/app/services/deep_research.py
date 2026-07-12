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
from app.services.search_providers import NormalizedResult, dedupe_and_rank, run_search

logger = logging.getLogger(__name__)

_openai = AsyncOpenAI(api_key=settings.openai_api_key)


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
    paperId: str | None  # set when sourced from the user's own library
    keyFindings: str = ""
    methodology: str = ""
    limitations: str = ""


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _persist_stage(chat_id: str, stages: list[dict]) -> None:
    await chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {"deepResearchStages": stages}})


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


async def _stage_search_external(sub_queries: list[str], providers: list[str] | None = None) -> list[Candidate]:
    result_lists: list[list[NormalizedResult]] = []
    for sub_query in sub_queries:
        result_lists.append(await run_search(sub_query, limit=10, providers=providers))
    merged = dedupe_and_rank(*result_lists)
    return [
        Candidate(
            title=r.title,
            authors=r.authors,
            year=r.year,
            venue=r.venue,
            abstract=r.abstract or "No abstract available.",
            citationCount=r.citationCount,
            doi=r.doi,
            url=r.url or r.pdfUrl,
            paperId=None,
        )
        for r in merged
    ]


async def _stage_load_folder(folder_id: str) -> list[Candidate]:
    docs = await papers.find({"folderId": ObjectId(folder_id)}).to_list(length=500)
    candidates = []
    for doc in docs:
        abstract = doc.get("abstract")
        if not abstract and doc.get("ingestionStatus") == "ready":
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
                paperId=str(doc["_id"]),
            )
        )
    return candidates


def _numbered_listing(candidates: list[Candidate], abstract_chars: int = 600) -> str:
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
            f"Question: {query}\n\nCandidates:\n\n{_numbered_listing(candidates)}",
        )
        keep_indices = [i - 1 for i in result.get("keep", []) if 0 < i <= len(candidates)]
        if keep_indices:
            return [candidates[i] for i in keep_indices[: settings.deep_research_screen_keep]]
    except Exception:
        logger.warning("Deep research screening failed, falling back to top-N", exc_info=True)
    return candidates[: settings.deep_research_screen_keep]


async def _stage_extract(query: str, candidates: list[Candidate]) -> list[Candidate]:
    try:
        result = await _llm_json(
            "You extract structured findings from paper abstracts for a research report. "
            "For each numbered paper, extract its key findings, methodology, and "
            'limitations (1-2 sentences each). Respond as JSON: {"papers": [{"index": '
            '<1-indexed>, "keyFindings": "...", "methodology": "...", "limitations": '
            '"..."}]}.',
            f"Question: {query}\n\nPapers:\n\n{_numbered_listing(candidates, abstract_chars=1200)}",
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
beyond what's given."""


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


async def _persist_final_report(chat_id: str, narration: str, markdown: str, references: list[dict]) -> dict:
    output = {"kind": "document", "markdown": markdown, "references": references}
    assistant_message = {"role": "assistant", "content": narration, "output": output}
    await chats.update_one(
        {"_id": ObjectId(chat_id)},
        {"$push": {"messages": assistant_message}, "$set": {"updatedAt": utcnow()}},
    )
    return output


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

    try:
        yield await set_stage("plan", "running")
        sub_queries = await _stage_plan(query)
        yield await set_stage("plan", "done", f"{len(sub_queries)} search angle(s) identified")

        yield await set_stage("search", "running")
        if scope == DeepResearchScope.folder:
            candidates = await _stage_load_folder(folder_id) if folder_id else []
        else:
            providers = ["arxiv"] if scope == DeepResearchScope.arxiv else None
            candidates = await _stage_search_external(sub_queries, providers=providers)
        yield await set_stage("search", "done", f"{len(candidates)} candidate paper(s) found")

        yield await set_stage("screen", "running")
        candidates = await _stage_screen(query, candidates)
        yield await set_stage("screen", "done", f"{len(candidates)} paper(s) kept")

        yield await set_stage("extract", "running")
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
        yield _sse({"error": "Report generation failed. Please try again."})


QUERY_EXPANSION_SYSTEM_PROMPT = """You turn a user's research question into a detailed
research brief for an autonomous web-research agent. Clarify the scope, list the key
sub-questions a thorough answer should cover, and note any implicit constraints. Respond
with the brief as plain text (no preamble, no JSON, no markdown headers) - it will be
passed directly to the research agent as its instructions."""


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


async def run_openai_deep_research(chat_id: str, query: str) -> AsyncGenerator[str, None]:
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

    try:
        yield await set_stage("planning", "running", "Expanding your question into a research brief…")
        brief = await _expand_query_for_deep_research(query)
        yield await set_stage("planning", "done", brief)

        yield await set_stage("research", "running", "Starting deep research…")
        stream = await _openai.responses.create(
            model=settings.deep_research_openai_model,
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
        logger.exception("OpenAI deep research pipeline failed for chat %s", chat_id)
        yield _sse({"error": "Report generation failed. Please try again."})
