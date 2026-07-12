import asyncio
import logging
import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from difflib import SequenceMatcher

import httpx

from app.config import settings
from app.services.ingestion import embed_texts

logger = logging.getLogger(__name__)

ATOM_NS = "{http://www.w3.org/2005/Atom}"


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


async def search_semantic_scholar(query: str, limit: int) -> list[NormalizedResult]:
    fields = "title,authors,year,venue,abstract,externalIds,citationCount,openAccessPdf,url"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                "https://api.semanticscholar.org/graph/v1/paper/search",
                params={"query": query, "limit": limit, "fields": fields},
            )
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError:
        logger.warning("Semantic Scholar search failed", exc_info=True)
        return []

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


async def search_arxiv(query: str, limit: int) -> list[NormalizedResult]:
    # Strip quote characters the user may have typed around a title (e.g. pasting
    # "Attention is All You Need" verbatim) — left in place, they'd nest inside the
    # phrase-search quotes added below and arXiv silently returns unrelated results
    # instead of erroring, so the real match never surfaces.
    clean_query = query.replace('"', "").strip()
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://export.arxiv.org/api/query",
                params={
                    "search_query": f'all:"{clean_query}"',
                    "max_results": limit,
                    "sortBy": "relevance",
                    "sortOrder": "descending",
                },
            )
            resp.raise_for_status()
            xml_text = resp.text
    except httpx.HTTPError:
        logger.warning("arXiv search failed", exc_info=True)
        return []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        logger.warning("Failed to parse arXiv Atom response", exc_info=True)
        return []

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


async def run_search(
    query: str, limit: int | None = None, providers: list[str] | None = None
) -> list[NormalizedResult]:
    """Search external providers. `providers` restricts which are queried (e.g. ["arxiv"]
    for an ArXiv-only scope); omitted/None queries all of them (today's default behavior).
    """
    limit = limit or settings.search_result_limit
    fetch_limit = min(limit * 2, 40)
    coros = []
    if providers is None or "semantic_scholar" in providers:
        coros.append(search_semantic_scholar(query, fetch_limit))
    if providers is None or "arxiv" in providers:
        coros.append(search_arxiv(query, fetch_limit))

    result_lists: list[list[NormalizedResult]] = []
    try:
        result_lists = await asyncio.gather(*coros)
    except Exception:
        logger.exception("Search provider fan-out failed")
    deduped = _dedupe(*result_lists)
    ranked = await rank_by_relevance(query, deduped)
    return ranked[:limit]
