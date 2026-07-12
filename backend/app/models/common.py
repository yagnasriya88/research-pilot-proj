from datetime import datetime, timezone
from typing import Any

from bson import ObjectId


def new_object_id() -> ObjectId:
    return ObjectId()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def serialize_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """Convert a raw Mongo document into a JSON-serializable dict: `_id` -> `id` (str),
    any other ObjectId fields -> str.
    """
    out = dict(doc)
    if "_id" in out:
        out["id"] = str(out.pop("_id"))
    for key, value in list(out.items()):
        if isinstance(value, ObjectId):
            out[key] = str(value)
        elif isinstance(value, list) and value and isinstance(value[0], ObjectId):
            out[key] = [str(v) for v in value]
    return out
