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

VECTOR_INDEX_NAME = "paper_chunks_vector_index"


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
