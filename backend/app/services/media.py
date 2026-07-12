import base64
import os
import uuid

from app.config import settings


def save_image_bytes(content: bytes) -> str:
    os.makedirs(settings.image_storage_dir, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.png"
    path = os.path.join(settings.image_storage_dir, filename)
    with open(path, "wb") as f:
        f.write(content)
    return path


def save_image_base64(data_url_or_b64: str) -> str:
    """Accepts either a raw base64 string or a `data:image/png;base64,...` data URL
    (what the frontend's canvas crop produces) and saves the decoded bytes to disk.
    """
    b64 = data_url_or_b64
    if "," in b64 and b64.strip().lower().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return save_image_bytes(base64.b64decode(b64))
