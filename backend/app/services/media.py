import base64

from app.services.storage import upload_image


async def save_image_bytes(content: bytes) -> str:
    return await upload_image(content)


async def save_image_base64(data_url_or_b64: str) -> str:
    """Accepts either a raw base64 string or a `data:image/png;base64,...` data URL
    (what the frontend's canvas crop produces) and uploads the decoded bytes to GridFS.
    """
    b64 = data_url_or_b64
    if "," in b64 and b64.strip().lower().startswith("data:"):
        b64 = b64.split(",", 1)[1]
    return await save_image_bytes(base64.b64decode(b64))
