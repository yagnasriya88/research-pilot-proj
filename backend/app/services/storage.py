from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, Response
from gridfs.errors import NoFile

from app.db.mongo import image_files, pdf_files


async def upload_pdf(content: bytes, filename: str = "document.pdf") -> str:
    file_id = await pdf_files.upload_from_stream(filename, content, metadata={"contentType": "application/pdf"})
    return str(file_id)


async def delete_pdf(file_id: str | None) -> None:
    if not file_id:
        return
    try:
        await pdf_files.delete(ObjectId(file_id))
    except (NoFile, InvalidId):
        pass


async def stream_pdf_response(file_id: str | None) -> Response:
    if not file_id:
        raise HTTPException(404, "No stored PDF for this item")
    try:
        grid_out = await pdf_files.open_download_stream(ObjectId(file_id))
        data = await grid_out.read()
    except (NoFile, InvalidId):
        raise HTTPException(404, "No stored PDF for this item")
    return Response(content=data, media_type="application/pdf")


async def upload_image(content: bytes, filename: str = "image.png") -> str:
    file_id = await image_files.upload_from_stream(filename, content, metadata={"contentType": "image/png"})
    return str(file_id)


async def stream_image_response(file_id: str) -> Response:
    try:
        grid_out = await image_files.open_download_stream(ObjectId(file_id))
        data = await grid_out.read()
    except (NoFile, InvalidId):
        raise HTTPException(404, "Image not found")
    return Response(content=data, media_type="image/png")
