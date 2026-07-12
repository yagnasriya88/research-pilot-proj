import asyncio
import logging
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from difflib import SequenceMatcher

import httpx

from app.config import settings
from app.services.ingestion import embed_texts

logger = logging.getLogger(__name__)

ATOM_NS = "{http://www.w3.org/2005/Atom}"

# Dropped when building an arXiv OR-query from a natural-language question — question words
# and basic English stopwords carry no topical signal and only dilute the OR match.
_ARXIV_STOPWORDS = {
    "a", "an", "the", "and", "or", "to", "of", "in", "on", "for", "is", "are", "do", "does",
    "how", "what", "why", "which", "that", "this", "relate", "related", "with", "about", "as",
    "be", "by", "from", "at", "it", "its", "these", "those", "can", "will", "would", "should",
}


@dataclass
class NormalizedResult:
    title: str
    authors: list[str]
    year: int | None
    venue: str | None
    abstract: str | None
    doi: str | None
    url: str | None
    pdfUrl: str | None
    citationCount: int | None
    source: str


@dataclass
class ProviderStatus:
    name: str
    ok: bool
    result_count: int
    error: str | None = None


async def search_semantic_scholar(query: str, limit: int) -> list[NormalizedResult]:
    # Errors intentionally propagate uncaught — the only caller, `run_search_with_status`,
    # catches per-coroutine via `asyncio.gather(return_exceptions=True)` so a failure here is
    # attributable to this specific provider rather than silently reading as "0 matches."
    fields = "title,authors,year,venue,abstract,externalIds,citationCount,openAccessPdf,url"
    headers = {"x-api-key": settings.semantic_scholar_api_key} if settings.semantic_scholar_api_key else {}
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(
            "https://api.semanticscholar.org/graph/v1/paper/search",
            params={"query": query, "limit": limit, "fields": fields},
            headers=headers,
        )
        resp.raise_for_status()
        data = resp.json()

    results = []
    for item in data.get("data", []):
        oa_pdf = item.get("openAccessPdf") or {}
        results.append(
            NormalizedResult(
                title=item.get("title") or "Untitled",
                authors=[a.get("name", "") for a in item.get("authors", []) if a.get("name")],
                year=item.get("year"),
                venue=item.get("venue") or None,
                abstract=item.get("abstract"),
                doi=(item.get("externalIds") or {}).get("DOI"),
                url=item.get("url"),
                pdfUrl=oa_pdf.get("url"),
                citationCount=item.get("citationCount"),
                source="semantic_scholar",
            )
        )
    return results


def _arxiv_pdf_url(entry_id: str) -> str:
    return entry_id.replace("/abs/", "/pdf/")


def _build_arxiv_search_query(query: str) -> str:
    """Exact-phrase quoting (`all:"..."`) only matches a paper whose metadata contains that
    literal phrase — appropriate when the caller pasted an exact title, but near-guaranteed to
    return 0 results for a natural-language question or an LLM-generated sub-query, since full
    sentences essentially never appear verbatim in a paper's title/abstract. Only phrase-quote
    when the raw query is itself quote-wrapped (a real "I pasted an exact title" signal);
    otherwise OR-join the significant terms using arXiv's documented boolean field-query
    syntax. OR (not AND) is deliberate: it maximizes recall for a long sentence, and precision
    is recovered downstream by `rank_by_relevance`'s embedding rerank.
    """
    stripped = query.strip()
    if len(stripped) > 2 and stripped.startswith('"') and stripped.endswith('"'):
        literal = stripped[1:-1].replace('"', "").strip()
        if literal:
            return f'all:"{literal}"'

    all_terms = re.findall(r"[A-Za-z0-9]+", stripped.lower())
    content_terms = [t for t in all_terms if t not in _ARXIV_STOPWORDS] or all_terms
    if not content_terms:
        return f'all:"{stripped}"' if stripped else "all:research"
    return " OR ".join(f"all:{t}" for t in content_terms)


async def search_arxiv(query: str, limit: int) -> list[NormalizedResult]:
    # Errors intentionally propagate uncaught — see the note on search_semantic_scholar.
    search_query = _build_arxiv_search_query(query)
    logger.debug("arXiv search_query: %s", search_query)
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        resp = await client.get(
            "https://export.arxiv.org/api/query",
            params={
                "search_query": search_query,
                "max_results": limit,
                "sortBy": "relevance",
                "sortOrder": "descending",
            },
        )
        resp.raise_for_status()
        xml_text = resp.text

    root = ET.fromstring(xml_text)

    results = []
    for entry in root.findall(f"{ATOM_NS}entry"):
        entry_id = (entry.findtext(f"{ATOM_NS}id") or "").strip()
        title = (entry.findtext(f"{ATOM_NS}title") or "Untitled").strip().replace("\n", " ")
        summary = (entry.findtext(f"{ATOM_NS}summary") or "").strip().replace("\n", " ")
        published = entry.findtext(f"{ATOM_NS}published") or ""
        year = int(published[:4]) if published[:4].isdigit() else None
        authors = [
            (author.findtext(f"{ATOM_NS}name") or "").strip()
            for author in entry.findall(f"{ATOM_NS}author")
        ]
        results.append(
            NormalizedResult(
                title=title,
                authors=[a for a in authors if a],
                year=year,
                venue="arXiv",
                abstract=summary or None,
                doi=None,
                url=entry_id or None,
                pdfUrl=_arxiv_pdf_url(entry_id) if entry_id else None,
                citationCount=None,
                source="arxiv",
            )
        )
    return results


def _titles_match(a: str, b: str) -> bool:
    return SequenceMatcher(None, a.lower(), b.lower()).ratio() > 0.9


def _dedupe(*result_lists: list[NormalizedResult]) -> list[NormalizedResult]:
    """Combine results from multiple providers, preserving relative order, and drop
    duplicates (matched by DOI or fuzzy title similarity).
    """
    combined: list[NormalizedResult] = []
    for results in result_lists:
        for candidate in results:
            is_duplicate = False
            for existing in combined:
                if candidate.doi and existing.doi and candidate.doi == existing.doi:
                    is_duplicate = True
                    break
                if _titles_match(candidate.title, existing.title):
                    is_duplicate = True
                    break
            if not is_duplicate:
                combined.append(candidate)
    return combined


def dedupe_and_rank(*result_lists: list[NormalizedResult]) -> list[NormalizedResult]:
    """Dedupe (matched by DOI or fuzzy title similarity), preserving relative order, and
    truncate to the configured display limit.
    """
    return _dedupe(*result_lists)[: settings.search_result_limit]


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def rank_by_relevance(query: str, results: list[NormalizedResult]) -> list[NormalizedResult]:
    """Re-rank results by embedding cosine similarity to the query, since provider-native
    ordering (especially arXiv's) isn't reliably relevance-sorted across a merged pool.
    """
    if not results:
        return results
    texts = [query] + [f"{r.title}. {r.abstract or ''}"[:2000] for r in results]
    vectors = await embed_texts(texts)
    query_vector, result_vectors = vectors[0], vectors[1:]
    scored = sorted(
        zip(results, result_vectors),
        key=lambda pair: _cosine_similarity(query_vector, pair[1]),
        reverse=True,
    )
    return [result for result, _ in scored]


async def run_search_with_status(
    query: str, limit: int | None = None, providers: list[str] | None = None
) -> tuple[list[NormalizedResult], list[ProviderStatus]]:
    """Search external providers, same as `run_search`, but also returns a `ProviderStatus`
    per provider so a caller (Deep Research's search stage) can tell "this provider legitimately
    found nothing" apart from "this provider errored out" — both currently collapse to an
    empty list otherwise, which makes a partial/total provider outage indistinguishable from a
    query that just has no matches.
    """
    limit = limit or settings.search_result_limit
    fetch_limit = min(limit * 2, 40)
    names: list[str] = []
    coros = []
    if providers is None or "semantic_scholar" in providers:
        names.append("semantic_scholar")
        coros.append(search_semantic_scholar(query, fetch_limit))
    if providers is None or "arxiv" in providers:
        names.append("arxiv")
        coros.append(search_arxiv(query, fetch_limit))

    outcomes = await asyncio.gather(*coros, return_exceptions=True)
    result_lists: list[list[NormalizedResult]] = []
    statuses: list[ProviderStatus] = []
    for name, outcome in zip(names, outcomes):
        if isinstance(outcome, Exception):
            logger.warning("%s search failed", name, exc_info=outcome)
            result_lists.append([])
            statuses.append(ProviderStatus(name=name, ok=False, result_count=0, error=str(outcome)))
        else:
            result_lists.append(outcome)
            statuses.append(ProviderStatus(name=name, ok=True, result_count=len(outcome)))

    deduped = _dedupe(*result_lists)
    ranked = await rank_by_relevance(query, deduped)
    return ranked[:limit], statuses


async def run_search(
    query: str, limit: int | None = None, providers: list[str] | None = None
) -> list[NormalizedResult]:
    """Search external providers. `providers` restricts which are queried (e.g. ["arxiv"]
    for an ArXiv-only scope); omitted/None queries all of them (today's default behavior).
    """
    results, _ = await run_search_with_status(query, limit=limit, providers=providers)
    return results
