import logging

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import OperationFailure

from app.config import settings

logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(settings.mongodb_uri)
db = client[settings.mongodb_db_name]

papers = db["papers"]
paper_chunks = db["paper_chunks"]
folders = db["folders"]
tags = db["tags"]
chats = db["chats"]
notebooks = db["notebooks"]
highlights = db["highlights"]
books = db["books"]
book_chunks = db["book_chunks"]
book_highlights = db["book_highlights"]
users = db["users"]

VECTOR_INDEX_NAME = "paper_chunks_vector_index"
BOOK_VECTOR_INDEX_NAME = "book_chunks_vector_index"


async def ensure_indexes() -> None:
    """Create indexes needed by the app. The Atlas Vector Search index can only be
    created on an Atlas cluster (not local/self-hosted Mongo), so failures there are
    logged and skipped rather than raised.
    """
    await papers.create_index("folderId")
    await papers.create_index("tagIds")
    await paper_chunks.create_index("paperId")
    await folders.create_index("parentId")
    await chats.create_index("updatedAt")
    await chats.create_index("type")
    await notebooks.create_index("updatedAt")
    await highlights.create_index("paperId")
    await book_highlights.create_index("bookId")
    await users.create_index("email", unique=True)

    try:
        existing = [idx async for idx in paper_chunks.list_search_indexes()]
        if not any(idx.get("name") == VECTOR_INDEX_NAME for idx in existing):
            await paper_chunks.create_search_index(
                {
                    "name": VECTOR_INDEX_NAME,
                    "type": "vectorSearch",
                    "definition": {
                        "fields": [
                            {
                                "type": "vector",
                                "path": "embedding",
                                "numDimensions": settings.embedding_dimensions,
                                "similarity": "cosine",
                            },
                            {"type": "filter", "path": "paperId"},
                        ]
                    },
                }
            )
            logger.info("Created Atlas Vector Search index %s", VECTOR_INDEX_NAME)
    except OperationFailure as exc:
        logger.warning(
            "Could not create Atlas Vector Search index (expected on non-Atlas "
            "MongoDB): %s",
            exc,
        )

    try:
        # A search index can only be created on a collection that already exists —
        # `book_chunks` isn't guaranteed to exist yet on a fresh database (unlike
        # `paper_chunks`, which papers create implicitly well before books do).
        existing_collections = await db.list_collection_names()
        if "book_chunks" not in existing_collections:
            await db.create_collection("book_chunks")

        # LlamaIndex's MongoDBAtlasVectorSearch stores custom metadata (incl. `bookId`)
        # nested under a `metadata` subdocument rather than top-level, unlike the
        # hand-rolled `paper_chunks` shape above.
        existing = [idx async for idx in book_chunks.list_search_indexes()]
        if not any(idx.get("name") == BOOK_VECTOR_INDEX_NAME for idx in existing):
            await book_chunks.create_search_index(
                {
                    "name": BOOK_VECTOR_INDEX_NAME,
                    "type": "vectorSearch",
                    "definition": {
                        "fields": [
                            {
                                "type": "vector",
                                "path": "embedding",
                                "numDimensions": settings.embedding_dimensions,
                                "similarity": "cosine",
                            },
                            {"type": "filter", "path": "metadata.bookId"},
                        ]
                    },
                }
            )
            logger.info("Created Atlas Vector Search index %s", BOOK_VECTOR_INDEX_NAME)
    except OperationFailure as exc:
        logger.warning(
            "Could not create Atlas Vector Search index (expected on non-Atlas "
            "MongoDB): %s",
            exc,
        )
