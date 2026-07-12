import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db.mongo import ensure_indexes
from app.routers import auth, books, chats, notebooks, references
from app.services.auth import get_current_user


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_indexes()
    yield


app = FastAPI(title="Research Pilot API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])

# Unguarded: raw PDF bytes, fetched by react-pdf/<a href> which can't send an Authorization
# header. See references.py::public_router.
app.include_router(references.public_router, prefix="/api/references", tags=["references"])
app.include_router(books.public_router, prefix="/api/books", tags=["books"])

_auth_guard = [Depends(get_current_user)]
app.include_router(references.router, prefix="/api/references", tags=["references"], dependencies=_auth_guard)
app.include_router(chats.router, prefix="/api/chats", tags=["chats"], dependencies=_auth_guard)
app.include_router(notebooks.router, prefix="/api/notebooks", tags=["notebooks"], dependencies=_auth_guard)
app.include_router(books.router, prefix="/api/books", tags=["books"], dependencies=_auth_guard)

os.makedirs(settings.image_storage_dir, exist_ok=True)
app.mount("/api/chat-images", StaticFiles(directory=settings.image_storage_dir), name="chat-images")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
