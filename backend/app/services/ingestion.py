import logging
from collections import Counter
from dataclasses import dataclass

import fitz  # PyMuPDF
import httpx
import tiktoken
from bson import ObjectId
from openai import AsyncOpenAI

from app.config import settings
from app.db.mongo import paper_chunks, papers
from app.models.common import utcnow
from app.models.paper import IngestionStatus

logger = logging.getLogger(__name__)

_encoding = tiktoken.get_encoding("cl100k_base")
_openai = AsyncOpenAI(api_key=settings.openai_api_key)

CONTACT_EMAIL = "research-pilot@example.com"


@dataclass
class ChunkDraft:
    chunk_index: int
    start_page: int
    end_page: int
    token_count: int
    text: str
    section: str | None = None
    section_index: int | None = None


def extract_pages(pdf_bytes: bytes) -> list[str]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def detect_sections(pdf_bytes: bytes) -> list[tuple[str, int]]:
    """Detect `(title, start_page)` breakpoints for a PDF's chapter/section structure,
    in document order. Tries the PDF's embedded outline (bookmarks) first; falls back
    to a font-size heuristic (headings render larger than surrounding body text) when
    no outline is present. Returns `[]` if neither source finds anything — callers
    should treat that as "no detectable structure" (a single implicit section).
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        toc = doc.get_toc(simple=True)
        if toc:
            return [(title.strip(), page) for _level, title, page in toc if title.strip()]
        return _detect_sections_by_heading_size(doc)
    finally:
        doc.close()


def _detect_sections_by_heading_size(doc: "fitz.Document") -> list[tuple[str, int]]:
    lines: list[tuple[str, int, float]] = []  # (text, page_num, font_size)

    for page_num, page in enumerate(doc, start=1):
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                text = "".join(s["text"] for s in spans).strip()
                if not text:
                    continue
                size = max(s["size"] for s in spans)
                lines.append((text, page_num, size))

    if not lines:
        return []

    # The most common (rounded) font size across the document is a reasonable proxy
    # for "body text" size; anything notably larger is a heading candidate.
    body_size = Counter(round(size) for _, _, size in lines).most_common(1)[0][0]
    threshold = body_size + 1.5

    candidates = [(text, page_num) for text, page_num, size in lines if size >= threshold and 3 <= len(text) <= 90]
    if not candidates:
        return []

    # Text repeated more than twice is almost certainly a running header/footer, not
    # a one-off section title — drop it, and keep only the first occurrence of the rest.
    text_counts = Counter(text for text, _ in candidates)
    seen: set[str] = set()
    sections: list[tuple[str, int]] = []
    for text, page_num in candidates:
        if text_counts[text] > 2 or text in seen:
            continue
        seen.add(text)
        sections.append((text, page_num))
    return sections


def assign_sections(chunks: list[ChunkDraft], sections: list[tuple[str, int]]) -> None:
    """Tag each chunk with the section it falls under (the last breakpoint at or
    before the chunk's start page), mutating `chunks` in place. No-op if no sections
    were detected — chunks keep `section=None`, which downstream retrieval treats as
    "no detectable structure" and falls back to a page-window instead.
    """
    if not sections:
        return
    ordered = sorted(sections, key=lambda s: s[1])
    for chunk in chunks:
        matched_index = -1
        for i, (_, start_page) in enumerate(ordered):
            if start_page <= chunk.start_page:
                matched_index = i
            else:
                break
        if matched_index >= 0:
            chunk.section = ordered[matched_index][0]
            chunk.section_index = matched_index


def chunk_pages(
    pages: list[str],
    chunk_tokens: int = settings.chunk_tokens,
    overlap_tokens: int = settings.chunk_overlap_tokens,
) -> list[ChunkDraft]:
    """Token-aware chunking with overlap, preserving which page(s) each chunk spans."""
    # Flatten to a stream of (token_id, page_number) so a chunk boundary can straddle pages.
    tokens_with_pages: list[tuple[int, int]] = []
    for page_num, page_text in enumerate(pages, start=1):
        for token_id in _encoding.encode(page_text):
            tokens_with_pages.append((token_id, page_num))

    chunks: list[ChunkDraft] = []
    step = max(chunk_tokens - overlap_tokens, 1)
    chunk_index = 0
    i = 0
    while i < len(tokens_with_pages):
        window = tokens_with_pages[i : i + chunk_tokens]
        if not window:
            break
        token_ids = [t for t, _ in window]
        page_nums = [p for _, p in window]
        text = _encoding.decode(token_ids).strip()
        if text:
            chunks.append(
                ChunkDraft(
                    chunk_index=chunk_index,
                    start_page=min(page_nums),
                    end_page=max(page_nums),
                    token_count=len(token_ids),
                    text=text,
                )
            )
            chunk_index += 1
        i += step
    return chunks


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Batches requests at `settings.embedding_batch_size` texts per OpenAI call, so a
    document with many chunks (e.g. a book) doesn't risk hitting the embeddings API's
    per-request size limit. A paper's chunk count is normally well under one batch, so
    this is a no-op extra loop iteration for the existing paper pipeline.
    """
    if not texts:
        return []
    embeddings: list[list[float]] = []
    batch_size = settings.embedding_batch_size
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        response = await _openai.embeddings.create(model=settings.embedding_model, input=batch)
        embeddings.extend(item.embedding for item in response.data)
    return embeddings


async def ingest_paper(paper_id: str, pdf_bytes: bytes) -> None:
    """Extract, chunk, embed, and store a paper's PDF. Updates ingestionStatus on
    success (`ready`) or failure (`failed`).
    """
    try:
        pages = extract_pages(pdf_bytes)
        drafts = chunk_pages(pages)
        assign_sections(drafts, detect_sections(pdf_bytes))
        embeddings = await embed_texts([d.text for d in drafts])

        docs = [
            {
                "paperId": ObjectId(paper_id),
                "chunkIndex": d.chunk_index,
                "startPage": d.start_page,
                "endPage": d.end_page,
                "tokenCount": d.token_count,
                "text": d.text,
                "embedding": embedding,
                "section": d.section,
                "sectionIndex": d.section_index,
            }
            for d, embedding in zip(drafts, embeddings)
        ]
        if docs:
            await paper_chunks.insert_many(docs)

        total_tokens = sum(d.token_count for d in drafts)
        await papers.update_one(
            {"_id": ObjectId(paper_id)},
            {
                "$set": {
                    "ingestionStatus": IngestionStatus.ready.value,
                    "pageCount": len(pages),
                    "totalTokens": total_tokens,
                }
            },
        )
    except Exception:
        logger.exception("Ingestion failed for paper %s", paper_id)
        await papers.update_one(
            {"_id": ObjectId(paper_id)},
            {"$set": {"ingestionStatus": IngestionStatus.failed.value}},
        )


async def download_bytes(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "pdf" not in content_type.lower() and not url.lower().endswith(".pdf"):
                return None
            return resp.content
    except httpx.HTTPError:
        logger.warning("Failed to download PDF from %s", url, exc_info=True)
        return None


async def fetch_crossref_metadata(doi: str) -> dict:
    """Look up basic citation metadata for a DOI via the free Crossref API."""
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"https://api.crossref.org/works/{doi}")
        resp.raise_for_status()
        message = resp.json()["message"]

    title = (message.get("title") or [None])[0] or doi
    authors = [
        f"{a.get('given', '')} {a.get('family', '')}".strip()
        for a in message.get("author", [])
        if a.get("family")
    ]
    year = None
    date_parts = message.get("issued", {}).get("date-parts", [[None]])
    if date_parts and date_parts[0]:
        year = date_parts[0][0]
    venue = (message.get("container-title") or [None])[0]

    return {"title": title, "authors": authors, "year": year, "venue": venue}


async def find_oa_pdf_url(doi: str) -> str | None:
    """Look up an open-access PDF link for a DOI via the free Unpaywall API."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"https://api.unpaywall.org/v2/{doi}", params={"email": CONTACT_EMAIL}
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            best = data.get("best_oa_location") or {}
            return best.get("url_for_pdf") or best.get("url")
    except httpx.HTTPError:
        logger.warning("Unpaywall lookup failed for DOI %s", doi, exc_info=True)
        return None


def now_timestamp():
    return utcnow()
