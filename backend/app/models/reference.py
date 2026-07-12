from pydantic import BaseModel


class FolderCreate(BaseModel):
    name: str
    parentId: str | None = None


class FolderUpdate(BaseModel):
    name: str | None = None
    parentId: str | None = None


class TagCreate(BaseModel):
    name: str
    color: str = "#94a3b8"
