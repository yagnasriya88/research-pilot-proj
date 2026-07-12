from enum import Enum
from typing import Literal

from pydantic import BaseModel

from app.models.paper import HighlightRect


class BookIngestionStatus(str, Enum):
    pending = "pending"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class BookUpdate(BaseModel):
    title: str | None = None
    author: str | None = None


class BookHighlightCreate(BaseModel):
    page: int
    color: Literal["yellow", "green", "blue", "pink"]
    rects: list[HighlightRect]
    quote: str
