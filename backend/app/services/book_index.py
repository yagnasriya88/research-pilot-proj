import asyncio
import logging

import fitz  # PyMuPDF
import pymongo
from bson import ObjectId
from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.node_parser import HierarchicalNodeParser, get_leaf_nodes
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.storage.docstore.mongodb import MongoDocumentStore
from llama_index.vector_stores.mongodb import MongoDBAtlasVectorSearch

from app.config import settings
from app.db.mongo import BOOK_VECTOR_INDEX_NAME
from app.models.book import BookIngestionStatus
from app.models.common import utcnow
from app.services.ingestion import _encoding, detect_sections, extract_pages

logger = logging.getLogger(__name__)

# LlamaIndex's Mongo integrations (vector store + docstore) use pymongo directly, not
# the app's Motor async client — shared clients are reused across requests rather than
# opening new connections per call. MongoDBAtlasVectorSearch keeps both a sync and an
# async pymongo client internally, so both are provided explicitly here (it otherwise
# falls back to reading a MONGODB_URI *process* env var, which this app doesn't set —
# config comes from .env via pydantic-settings instead).
_pymongo_client = pymongo.MongoClient(settings.mongodb_uri)
_async_pymongo_client = pymongo.AsyncMongoClient(settings.mongodb_uri)

BOOK_CHUNK_NODES_NAMESPACE = "book_chunk_nodes"


def get_book_vector_store() -> MongoDBAtlasVectorSearch:
    return MongoDBAtlasVectorSearch(
        mongodb_client=_pymongo_client,
        async_mongodb_client=_async_pymongo_client,
        db_name=settings.mongodb_db_name,
        collection_name="book_chunks",
        vector_index_name=BOOK_VECTOR_INDEX_NAME,
    )


def get_book_docstore() -> MongoDocumentStore:
    return MongoDocumentStore.from_uri(
        settings.mongodb_uri,
        db_name=settings.mongodb_db_name,
        namespace=BOOK_CHUNK_NODES_NAMESPACE,
    )


def get_book_storage_context() -> StorageContext:
    return StorageContext.from_defaults(docstore=get_book_docstore(), vector_store=get_book_vector_store())


def get_book_embed_model() -> OpenAIEmbedding:
    return OpenAIEmbedding(model=settings.embedding_model, api_key=settings.openai_api_key)


def _write_and_embed_nodes(docstore, nodes, leaf_nodes, embed_model, insert_batch_size) -> None:
    """Synchronous tail of ingestion: persists the full node tree (`docstore.add_documents`,
    a blocking pymongo write of every chapter/section/paragraph node) and embeds+indexes the
    leaf nodes (`VectorStoreIndex`, blocking OpenAI + pymongo calls). Both are real,
    non-trivial-duration blocking I/O for a book-scale tree, so they're run together in one
    worker thread via `asyncio.to_thread` rather than directly on the event loop.
    """
    docstore.add_documents(nodes)
    storage_context = StorageContext.from_defaults(docstore=docstore, vector_store=get_book_vector_store())
    VectorStoreIndex(
        nodes=leaf_nodes,
        storage_context=storage_context,
        embed_model=embed_model,
        insert_batch_size=insert_batch_size,
    )


def _read_table_of_contents(pdf_path: str) -> list[dict]:
    doc = fitz.open(pdf_path)
    try:
        toc = doc.get_toc(simple=True)
        return [{"title": title.strip(), "page": page, "level": level} for level, title, page in toc if title.strip()]
    finally:
        doc.close()


def _build_chapter_documents(book_id: str, pages: list[str], sections: list[tuple[str, int]]) -> list[Document]:
    """One LlamaIndex Document per detected chapter/section breakpoint (the same
    breakpoints `detect_sections` already finds for papers), each spanning from its own
    start page to the next breakpoint's start page. Falls back to a single
    whole-book Document when no structure was detected at all.
    """
    if not sections:
        return [
            Document(
                text="\n\n".join(pages),
                metadata={
                    "bookId": book_id,
                    "chapterTitle": "Full text",
                    "startPage": 1,
                    "endPage": len(pages),
                },
            )
        ]

    ordered = sorted(sections, key=lambda s: s[1])
    documents: list[Document] = []
    for i, (title, start_page) in enumerate(ordered):
        end_page = ordered[i + 1][1] - 1 if i + 1 < len(ordered) else len(pages)
        end_page = max(end_page, start_page)
        chapter_text = "\n\n".join(pages[start_page - 1 : end_page])
        if not chapter_text.strip():
            continue
        documents.append(
            Document(
                text=chapter_text,
                metadata={
                    "bookId": book_id,
                    "chapterTitle": title,
                    "startPage": start_page,
                    "endPage": end_page,
                },
            )
        )
    return documents


async def ingest_book(book_id: str, pdf_path: str) -> None:
    """Extract, hierarchically chunk, embed, and index a book's PDF via LlamaIndex.
    Runs as a FastAPI background task (see routers/books.py), not inline with the
    upload request — book-scale ingestion is too slow to hold a request open for.
    """
    from app.db.mongo import books  # local import avoids a circular import with routers

    try:
        await books.update_one(
            {"_id": ObjectId(book_id)}, {"$set": {"ingestionStatus": BookIngestionStatus.processing.value}}
        )

        pages = extract_pages(pdf_path)
        sections = detect_sections(pdf_path)
        toc = _read_table_of_contents(pdf_path)

        documents = _build_chapter_documents(book_id, pages, sections)

        parser = HierarchicalNodeParser.from_defaults(chunk_sizes=settings.book_chunk_sizes)
        nodes = parser.get_nodes_from_documents(documents)
        leaf_nodes = get_leaf_nodes(nodes)

        docstore = get_book_docstore()
        embed_model = get_book_embed_model()

        # LlamaIndex's `use_async=True` path assumes it can drive its own event loop, which
        # conflicts with already running inside one here (this coroutine executes as a
        # FastAPI BackgroundTask on the app's own loop). Running the sync docstore write +
        # embedding calls directly would block that loop for their entire duration —
        # freezing every other request the server is handling, not just this ingestion —
        # so they're offloaded to a worker thread instead.
        await asyncio.to_thread(
            _write_and_embed_nodes, docstore, nodes, leaf_nodes, embed_model, settings.embedding_batch_size
        )

        total_tokens = sum(len(_encoding.encode(n.get_content())) for n in leaf_nodes)

        await books.update_one(
            {"_id": ObjectId(book_id)},
            {
                "$set": {
                    "ingestionStatus": BookIngestionStatus.ready.value,
                    "pageCount": len(pages),
                    "totalTokens": total_tokens,
                    "tableOfContents": toc,
                    "updatedAt": utcnow(),
                }
            },
        )
    except Exception:
        logger.exception("Ingestion failed for book %s", book_id)
        await books.update_one(
            {"_id": ObjectId(book_id)}, {"$set": {"ingestionStatus": BookIngestionStatus.failed.value}}
        )
