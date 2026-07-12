from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.mongo import ensure_indexes
from app.routers import chats, notebooks, references


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

app.include_router(references.router, prefix="/api/references", tags=["references"])
app.include_router(chats.router, prefix="/api/chats", tags=["chats"])
app.include_router(notebooks.router, prefix="/api/notebooks", tags=["notebooks"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
