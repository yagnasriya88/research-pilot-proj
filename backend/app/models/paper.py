from enum import Enum
from typing import Literal

from pydantic import BaseModel


class IngestionStatus(str, Enum):
    pending = "pending"
    ready = "ready"
    no_pdf = "no_pdf"
    failed = "failed"


class PaperSource(str, Enum):
    upload = "upload"
    url = "url"
    manual = "manual"


class ManualPaperCreate(BaseModel):
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    folderId: str | None = None


class UrlPaperCreate(BaseModel):
    url: str | None = None
    doi: str | None = None
    folderId: str | None = None


class FromSearchPaperCreate(BaseModel):
    title: str
    authors: list[str] = []
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    abstract: str | None = None
    citationCount: int | None = None
    url: str | None = None
    pdfUrl: str | None = None
    folderId: str | None = None


class PaperUpdate(BaseModel):
    folderId: str | None = None
    tagIds: list[str] | None = None
    title: str | None = None


class HighlightRect(BaseModel):
    x: float
    y: float
    width: float
    height: float


class HighlightCreate(BaseModel):
    page: int
    color: Literal["yellow", "green", "blue", "pink"]
    rects: list[HighlightRect]
    quote: str
