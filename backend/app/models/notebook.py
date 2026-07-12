from pydantic import BaseModel


class NotebookCreate(BaseModel):
    title: str
    content: str = ""


class NotebookUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
