from pathlib import Path

from bson import ObjectId
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.db.mongo import folders, highlights, papers, tags
from app.models.common import serialize_doc, utcnow
from app.models.paper import (
    FromSearchPaperCreate,
    HighlightCreate,
    IngestionStatus,
    ManualPaperCreate,
    PaperSource,
    PaperUpdate,
    UrlPaperCreate,
)
from app.models.reference import FolderCreate, FolderUpdate, TagCreate
from app.services.ingestion import (
    fetch_crossref_metadata,
    find_oa_pdf_url,
    ingest_paper,
    save_pdf_bytes,
    download_bytes,
)

router = APIRouter()

# Raw PDF bytes are served through a separate, unguarded router — react-pdf's <Document file={url}>
# and plain <a href> download links can't attach an Authorization header, so these routes are
# exempted from the auth guard (mounted without it in main.py). Paper IDs are unguessable Mongo
# ObjectIds, matching the existing accepted tradeoff for the /api/chat-images static mount.
public_router = APIRouter()


# ---- Folders ----


@router.get("/folders")
async def list_folders():
    return [serialize_doc(f) async for f in folders.find({})]


@router.post("/folders", status_code=201)
async def create_folder(body: FolderCreate):
    doc = {
        "name": body.name,
        "parentId": ObjectId(body.parentId) if body.parentId else None,
        "createdAt": utcnow(),
    }
    result = await folders.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.patch("/folders/{folder_id}")
async def update_folder(folder_id: str, body: FolderUpdate):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k != "parentId"}
    if body.parentId is not None:
        updates["parentId"] = ObjectId(body.parentId) if body.parentId else None
    if updates:
        await folders.update_one({"_id": ObjectId(folder_id)}, {"$set": updates})
    doc = await folders.find_one({"_id": ObjectId(folder_id)})
    if not doc:
        raise HTTPException(404, "Folder not found")
    return serialize_doc(doc)


@router.delete("/folders/{folder_id}", status_code=204)
async def delete_folder(folder_id: str):
    await folders.delete_one({"_id": ObjectId(folder_id)})
    await papers.update_many({"folderId": ObjectId(folder_id)}, {"$set": {"folderId": None}})


# ---- Tags ----


@router.get("/tags")
async def list_tags():
    return [serialize_doc(t) async for t in tags.find({})]


@router.post("/tags", status_code=201)
async def create_tag(body: TagCreate):
    doc = {"name": body.name, "color": body.color, "createdAt": utcnow()}
    result = await tags.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.delete("/tags/{tag_id}", status_code=204)
async def delete_tag(tag_id: str):
    await tags.delete_one({"_id": ObjectId(tag_id)})
    await papers.update_many({"tagIds": ObjectId(tag_id)}, {"$pull": {"tagIds": ObjectId(tag_id)}})


# ---- Papers ----


@router.get("/papers")
async def list_papers(
    folderId: str | None = None,
    tagId: str | None = None,
    author: str | None = None,
    year: int | None = None,
    hasPdf: bool | None = None,
    search: str | None = None,
):
    query: dict = {}
    if folderId:
        query["folderId"] = ObjectId(folderId)
    if tagId:
        query["tagIds"] = ObjectId(tagId)
    if author:
        query["authors"] = {"$regex": author, "$options": "i"}
    if year:
        query["year"] = year
    if hasPdf is not None:
        query["ingestionStatus"] = IngestionStatus.ready.value if hasPdf else {"$ne": IngestionStatus.ready.value}
    if search:
        query["title"] = {"$regex": search, "$options": "i"}

    return [serialize_doc(p) async for p in papers.find(query).sort("createdAt", -1)]


@router.get("/papers/{paper_id}")
async def get_paper(paper_id: str):
    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    if not doc:
        raise HTTPException(404, "Paper not found")
    return serialize_doc(doc)


@router.patch("/papers/{paper_id}")
async def update_paper(paper_id: str, body: PaperUpdate):
    updates = {}
    if body.title is not None:
        updates["title"] = body.title
    if body.folderId is not None:
        updates["folderId"] = ObjectId(body.folderId) if body.folderId else None
    if body.tagIds is not None:
        updates["tagIds"] = [ObjectId(t) for t in body.tagIds]
    if updates:
        await papers.update_one({"_id": ObjectId(paper_id)}, {"$set": updates})
    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    if not doc:
        raise HTTPException(404, "Paper not found")
    return serialize_doc(doc)


@router.delete("/papers/{paper_id}", status_code=204)
async def delete_paper(paper_id: str):
    await papers.delete_one({"_id": ObjectId(paper_id)})


@public_router.get("/papers/{paper_id}/pdf")
async def get_paper_pdf(paper_id: str):
    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    if not doc or not doc.get("pdfPath") or not Path(doc["pdfPath"]).is_file():
        raise HTTPException(404, "No stored PDF for this paper")
    return FileResponse(doc["pdfPath"], media_type="application/pdf")


@router.post("/papers/{paper_id}/highlights", status_code=201)
async def create_highlight(paper_id: str, body: HighlightCreate):
    doc = {
        "paperId": ObjectId(paper_id),
        "page": body.page,
        "color": body.color,
        "rects": [r.model_dump() for r in body.rects],
        "quote": body.quote,
        "createdAt": utcnow(),
    }
    result = await highlights.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/papers/{paper_id}/highlights")
async def list_highlights(paper_id: str):
    return [serialize_doc(h) async for h in highlights.find({"paperId": ObjectId(paper_id)}).sort("createdAt", 1)]


async def _create_paper_stub(
    title: str,
    authors: list[str],
    year: int | None,
    venue: str | None,
    doi: str | None,
    folder_id: str | None,
    source: PaperSource,
    abstract: str | None = None,
    source_url: str | None = None,
) -> str:
    doc = {
        "title": title,
        "authors": authors,
        "year": year,
        "venue": venue,
        "doi": doi,
        "abstract": abstract,
        "sourceUrl": source_url,
        "folderId": ObjectId(folder_id) if folder_id else None,
        "tagIds": [],
        "type": "Journal Article",
        "source": source.value,
        "pdfPath": None,
        "ingestionStatus": IngestionStatus.pending.value,
        "createdAt": utcnow(),
    }
    result = await papers.insert_one(doc)
    return str(result.inserted_id)


@router.post("/papers/upload-file", status_code=201)
async def upload_file(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    folderId: str | None = Form(None),
):
    content = await file.read()
    paper_title = title or (file.filename.rsplit(".", 1)[0] if file.filename else "Untitled")
    paper_id = await _create_paper_stub(
        title=paper_title,
        authors=[],
        year=None,
        venue=None,
        doi=None,
        folder_id=folderId,
        source=PaperSource.upload,
    )
    pdf_path = save_pdf_bytes(content)
    await papers.update_one({"_id": ObjectId(paper_id)}, {"$set": {"pdfPath": pdf_path}})
    await ingest_paper(paper_id, pdf_path)
    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    return serialize_doc(doc)


@router.post("/papers/upload-url", status_code=201)
async def upload_url(body: UrlPaperCreate):
    if not body.doi and not body.url:
        raise HTTPException(400, "Either doi or url is required")

    metadata = {"title": body.url or body.doi, "authors": [], "year": None, "venue": None}
    pdf_bytes: bytes | None = None
    source_url = body.url

    if body.doi:
        try:
            metadata = await fetch_crossref_metadata(body.doi)
        except Exception:
            pass
        oa_url = await find_oa_pdf_url(body.doi)
        if oa_url:
            pdf_bytes = await download_bytes(oa_url)
            source_url = source_url or oa_url
    elif body.url:
        pdf_bytes = await download_bytes(body.url)

    paper_id = await _create_paper_stub(
        title=metadata["title"],
        authors=metadata.get("authors", []),
        year=metadata.get("year"),
        venue=metadata.get("venue"),
        doi=body.doi,
        folder_id=body.folderId,
        source=PaperSource.url,
        source_url=source_url,
    )

    if pdf_bytes:
        pdf_path = save_pdf_bytes(pdf_bytes)
        await papers.update_one({"_id": ObjectId(paper_id)}, {"$set": {"pdfPath": pdf_path}})
        await ingest_paper(paper_id, pdf_path)
    else:
        await papers.update_one(
            {"_id": ObjectId(paper_id)}, {"$set": {"ingestionStatus": IngestionStatus.no_pdf.value}}
        )

    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    return serialize_doc(doc)


@router.post("/papers/manual", status_code=201)
async def add_manual(body: ManualPaperCreate):
    paper_id = await _create_paper_stub(
        title=body.title,
        authors=body.authors,
        year=body.year,
        venue=body.venue,
        doi=body.doi,
        folder_id=body.folderId,
        source=PaperSource.manual,
    )
    await papers.update_one(
        {"_id": ObjectId(paper_id)}, {"$set": {"ingestionStatus": IngestionStatus.no_pdf.value}}
    )
    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    return serialize_doc(doc)


@router.post("/papers/from-search", status_code=201)
async def add_from_search(body: FromSearchPaperCreate):
    """Save a specific AI Search result into Reference Manager. Unlike upload-url, the
    caller already has full metadata and (possibly) a direct PDF URL from the search
    provider, so no Crossref/Unpaywall round-trip is needed.
    """
    paper_id = await _create_paper_stub(
        title=body.title,
        authors=body.authors,
        year=body.year,
        venue=body.venue,
        doi=body.doi,
        folder_id=body.folderId,
        source=PaperSource.url,
        abstract=body.abstract,
        source_url=body.url or body.pdfUrl,
    )
    if body.citationCount is not None:
        await papers.update_one({"_id": ObjectId(paper_id)}, {"$set": {"citationCount": body.citationCount}})

    pdf_bytes = await download_bytes(body.pdfUrl) if body.pdfUrl else None
    if pdf_bytes:
        pdf_path = save_pdf_bytes(pdf_bytes)
        await papers.update_one({"_id": ObjectId(paper_id)}, {"$set": {"pdfPath": pdf_path}})
        await ingest_paper(paper_id, pdf_path)
    else:
        await papers.update_one(
            {"_id": ObjectId(paper_id)}, {"$set": {"ingestionStatus": IngestionStatus.no_pdf.value}}
        )

    doc = await papers.find_one({"_id": ObjectId(paper_id)})
    return serialize_doc(doc)
