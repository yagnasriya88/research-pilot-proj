from pathlib import Path

import fitz  # PyMuPDF
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.db.mongo import book_chunks, book_highlights, books
from app.models.book import BookHighlightCreate, BookIngestionStatus, BookUpdate
from app.models.common import serialize_doc, utcnow
from app.services.book_index import ingest_book
from app.services.ingestion import save_pdf_bytes

router = APIRouter()

# See references.py::public_router for why raw PDF bytes are exempted from the auth guard.
public_router = APIRouter()


def _extract_title_author(pdf_path: str, filename: str | None) -> tuple[str, str | None]:
    try:
        doc = fitz.open(pdf_path)
        try:
            meta = doc.metadata or {}
        finally:
            doc.close()
    except Exception:
        meta = {}
    title = meta.get("title") or (filename.rsplit(".", 1)[0] if filename else "Untitled")
    author = meta.get("author") or None
    return title, author


@router.post("/upload", status_code=201)
async def upload_book(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    content = await file.read()
    pdf_path = save_pdf_bytes(content)
    title, author = _extract_title_author(pdf_path, file.filename)

    doc = {
        "title": title,
        "author": author,
        "pdfPath": pdf_path,
        "pageCount": None,
        "totalTokens": None,
        "tableOfContents": [],
        "ingestionStatus": BookIngestionStatus.pending.value,
        "createdAt": utcnow(),
        "updatedAt": utcnow(),
    }
    result = await books.insert_one(doc)
    book_id = str(result.inserted_id)

    background_tasks.add_task(ingest_book, book_id, pdf_path)

    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("")
async def list_books():
    return [serialize_doc(b) async for b in books.find({}).sort("createdAt", -1)]


@router.get("/{book_id}")
async def get_book(book_id: str):
    doc = await books.find_one({"_id": ObjectId(book_id)})
    if not doc:
        raise HTTPException(404, "Book not found")
    return serialize_doc(doc)


@router.patch("/{book_id}")
async def update_book(book_id: str, body: BookUpdate):
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if updates:
        updates["updatedAt"] = utcnow()
        await books.update_one({"_id": ObjectId(book_id)}, {"$set": updates})
    doc = await books.find_one({"_id": ObjectId(book_id)})
    if not doc:
        raise HTTPException(404, "Book not found")
    return serialize_doc(doc)


@router.delete("/{book_id}", status_code=204)
async def delete_book(book_id: str):
    doc = await books.find_one({"_id": ObjectId(book_id)})
    await book_chunks.delete_many({"metadata.bookId": book_id})
    # Deliberately not walking the LlamaIndex docstore's parent-node chain here — the
    # leftover chapter/section-tier entries are inert (never surfaced without a matching
    # leaf hit from `book_chunks`, which is what's actually deleted above), so skipping
    # that cleanup trades a small amount of harmless orphaned storage for a much simpler
    # delete path.
    await book_highlights.delete_many({"bookId": ObjectId(book_id)})
    await books.delete_one({"_id": ObjectId(book_id)})
    if doc and doc.get("pdfPath") and Path(doc["pdfPath"]).is_file():
        Path(doc["pdfPath"]).unlink(missing_ok=True)


@public_router.get("/{book_id}/pdf")
async def get_book_pdf(book_id: str):
    doc = await books.find_one({"_id": ObjectId(book_id)})
    if not doc or not doc.get("pdfPath") or not Path(doc["pdfPath"]).is_file():
        raise HTTPException(404, "No stored PDF for this book")
    return FileResponse(doc["pdfPath"], media_type="application/pdf")


@router.post("/{book_id}/highlights", status_code=201)
async def create_book_highlight(book_id: str, body: BookHighlightCreate):
    doc = {
        "bookId": ObjectId(book_id),
        "page": body.page,
        "color": body.color,
        "rects": [r.model_dump() for r in body.rects],
        "quote": body.quote,
        "createdAt": utcnow(),
    }
    result = await book_highlights.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("/{book_id}/highlights")
async def list_book_highlights(book_id: str):
    return [
        serialize_doc(h)
        async for h in book_highlights.find({"bookId": ObjectId(book_id)}).sort("createdAt", 1)
    ]
