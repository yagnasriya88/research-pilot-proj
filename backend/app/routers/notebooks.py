from bson import ObjectId
from fastapi import APIRouter, HTTPException

from app.db.mongo import notebooks
from app.models.common import serialize_doc, utcnow
from app.models.notebook import NotebookCreate, NotebookUpdate

router = APIRouter()


def _snippet(content: str, length: int = 140) -> str:
    return " ".join(content.split())[:length]


@router.post("", status_code=201)
async def create_notebook(body: NotebookCreate):
    now = utcnow()
    doc = {"title": body.title, "content": body.content, "createdAt": now, "updatedAt": now}
    result = await notebooks.insert_one(doc)
    doc["_id"] = result.inserted_id
    return serialize_doc(doc)


@router.get("")
async def list_notebooks():
    result = []
    async for n in notebooks.find({}).sort("updatedAt", -1):
        out = serialize_doc(n)
        out["snippet"] = _snippet(out.pop("content", ""))
        result.append(out)
    return result


@router.get("/{notebook_id}")
async def get_notebook(notebook_id: str):
    doc = await notebooks.find_one({"_id": ObjectId(notebook_id)})
    if not doc:
        raise HTTPException(404, "Notebook not found")
    return serialize_doc(doc)


@router.patch("/{notebook_id}")
async def update_notebook(notebook_id: str, body: NotebookUpdate):
    updates = {}
    if body.title is not None:
        updates["title"] = body.title
    if body.content is not None:
        updates["content"] = body.content
    if updates:
        updates["updatedAt"] = utcnow()
        await notebooks.update_one({"_id": ObjectId(notebook_id)}, {"$set": updates})
    doc = await notebooks.find_one({"_id": ObjectId(notebook_id)})
    if not doc:
        raise HTTPException(404, "Notebook not found")
    return serialize_doc(doc)


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(notebook_id: str):
    await notebooks.delete_one({"_id": ObjectId(notebook_id)})
