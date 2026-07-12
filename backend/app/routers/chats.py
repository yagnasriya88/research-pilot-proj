import json

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.config import settings
from app.db.mongo import books, chats, folders, papers
from app.models.chat import (
    AddSourceRequest,
    ChatCreate,
    ChatRename,
    ChatType,
    DeepResearchMode,
    DeepResearchScope,
    ExcerptRef,
    ImageExcerptRef,
    MessageCreate,
    SearchScope,
)
from app.models.common import serialize_doc, utcnow
from app.services.book_rag import build_book_local_context, run_book_chat, run_book_excerpt_chat
from app.services.deep_research import run_openai_deep_research
from app.services.deep_research import run_pipeline as run_deep_research_pipeline
from app.services.media import save_image_base64
from app.services.rag import (
    build_context,
    build_excerpt_context,
    build_excerpt_messages,
    build_messages,
    run_library_search,
)
from app.services.search_providers import run_search
from app.services.search_summary import build_search_summary_messages
from app.services.streaming import stream_chat_completion
from app.services.vision_chat import build_image_messages

router = APIRouter()


async def _paper_titles(paper_ids: list[ObjectId]) -> list[dict]:
    if not paper_ids:
        return []
    docs = await papers.find({"_id": {"$in": paper_ids}}, {"title": 1}).to_list(length=len(paper_ids))
    by_id = {str(d["_id"]): d["title"] for d in docs}
    return [{"id": str(pid), "title": by_id.get(str(pid), "Untitled")} for pid in paper_ids]


async def _folder_summaries(folder_ids: list[ObjectId]) -> list[dict]:
    if not folder_ids:
        return []
    docs = await folders.find({"_id": {"$in": folder_ids}}, {"name": 1}).to_list(length=len(folder_ids))
    result = []
    for d in docs:
        count = await papers.count_documents({"folderId": d["_id"]})
        result.append({"id": str(d["_id"]), "name": d["name"], "paperCount": count})
    return result


async def _book_summary(book_id: ObjectId | None) -> dict | None:
    if not book_id:
        return None
    doc = await books.find_one({"_id": book_id}, {"title": 1})
    return {"id": str(book_id), "title": doc["title"]} if doc else None


async def _sources_payload(chat_doc: dict) -> dict:
    return {
        "folders": await _folder_summaries(chat_doc.get("sourceFolderIds", [])),
        "papers": await _paper_titles(chat_doc.get("sourcePaperIds", [])),
        "book": await _book_summary(chat_doc.get("sourceBookId")),
    }


async def _build_and_insert_chat(body: ChatCreate) -> dict:
    source_folder_oids = [ObjectId(fid) for fid in body.sourceFolderIds]
    source_paper_oids = [ObjectId(pid) for pid in body.sourcePaperIds]
    source_book_oid = ObjectId(body.sourceBookId) if body.sourceBookId else None

    title = body.title
    if not title:
        if body.type == ChatType.chat_with_pdf:
            papers_preview = await _paper_titles(source_paper_oids or source_folder_oids[:1])
            title = papers_preview[0]["title"] if papers_preview else "New Chat"
        elif body.type == ChatType.chat_with_book and source_book_oid:
            book_doc = await books.find_one({"_id": source_book_oid}, {"title": 1})
            title = book_doc["title"] if book_doc else "New Chat"
        else:
            title = "New Chat"

    now = utcnow()
    doc = {
        "type": body.type.value,
        "title": title,
        "sourceFolderIds": source_folder_oids,
        "sourcePaperIds": source_paper_oids,
        "sourceBookId": source_book_oid,
        "deepResearchScope": body.deepResearchScope.value if body.deepResearchScope else None,
        "deepResearchMode": body.deepResearchMode.value if body.deepResearchMode else None,
        "searchScope": body.searchScope.value if body.searchScope else None,
        "deepResearchStages": None,
        "messages": [],
        "createdAt": now,
        "updatedAt": now,
    }
    result = await chats.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


@router.post("", status_code=201)
async def create_chat(body: ChatCreate):
    if body.type == ChatType.chat_with_pdf and not body.sourceFolderIds and not body.sourcePaperIds:
        raise HTTPException(400, "At least one source folder or paper is required")
    if body.type == ChatType.chat_with_book and not body.sourceBookId:
        raise HTTPException(400, "A source book is required")
    if body.type == ChatType.deep_research:
        if body.deepResearchScope == DeepResearchScope.folder and not body.sourceFolderIds:
            raise HTTPException(400, "A folder is required for folder-scoped Deep Research")

    doc = await _build_and_insert_chat(body)
    out = serialize_doc(doc)
    out["sources"] = await _sources_payload(doc)
    return out


@router.get("/for-book/{book_id}")
async def get_or_create_chat_for_book(book_id: str):
    """Find-or-create the single-book `chat_with_book` chat for a given book — mirrors
    `get_or_create_chat_for_paper` below.
    """
    existing = await chats.find_one({"type": ChatType.chat_with_book.value, "sourceBookId": ObjectId(book_id)})
    doc = existing or await _build_and_insert_chat(ChatCreate(type=ChatType.chat_with_book, sourceBookId=book_id))
    out = serialize_doc(doc)
    out["sources"] = await _sources_payload(doc)
    return out


@router.get("/for-paper/{paper_id}")
async def get_or_create_chat_for_paper(paper_id: str):
    """Find-or-create the single-paper `chat_with_pdf` chat for a given paper, so the
    Reader always resumes the same conversation instead of creating a new chat on
    every visit. Deliberately exact-matches `sourcePaperIds == [paper_id]` with no
    folder sources — a chat that also includes other papers/folders doesn't count as
    "the" chat for this paper.
    """
    existing = await chats.find_one(
        {
            "type": ChatType.chat_with_pdf.value,
            "sourcePaperIds": [ObjectId(paper_id)],
            "sourceFolderIds": [],
        }
    )
    doc = existing or await _build_and_insert_chat(
        ChatCreate(type=ChatType.chat_with_pdf, sourcePaperIds=[paper_id])
    )
    out = serialize_doc(doc)
    out["sources"] = await _sources_payload(doc)
    return out


@router.get("")
async def list_chats(type: str | None = None):
    query = {"type": type} if type else {}
    result = []
    async for c in chats.find(query).sort("updatedAt", -1):
        out = serialize_doc(c)
        out["sources"] = await _sources_payload(c)
        out.pop("messages", None)
        result.append(out)
    return result


@router.get("/{chat_id}")
async def get_chat(chat_id: str):
    doc = await chats.find_one({"_id": ObjectId(chat_id)})
    if not doc:
        raise HTTPException(404, "Chat not found")
    out = serialize_doc(doc)
    out["sources"] = await _sources_payload(doc)
    return out


@router.patch("/{chat_id}")
async def rename_chat(chat_id: str, body: ChatRename):
    await chats.update_one({"_id": ObjectId(chat_id)}, {"$set": {"title": body.title}})
    doc = await chats.find_one({"_id": ObjectId(chat_id)})
    if not doc:
        raise HTTPException(404, "Chat not found")
    return serialize_doc(doc)


@router.delete("/{chat_id}", status_code=204)
async def delete_chat(chat_id: str):
    await chats.delete_one({"_id": ObjectId(chat_id)})


@router.post("/{chat_id}/sources", status_code=201)
async def add_source(chat_id: str, body: AddSourceRequest):
    if not body.paperId and not body.folderId:
        raise HTTPException(400, "Either paperId or folderId is required")
    update: dict = {}
    if body.paperId:
        update.setdefault("$addToSet", {})["sourcePaperIds"] = ObjectId(body.paperId)
    if body.folderId:
        update.setdefault("$addToSet", {})["sourceFolderIds"] = ObjectId(body.folderId)
    await chats.update_one({"_id": ObjectId(chat_id)}, update)
    doc = await chats.find_one({"_id": ObjectId(chat_id)})
    if not doc:
        raise HTTPException(404, "Chat not found")
    out = serialize_doc(doc)
    out["sources"] = await _sources_payload(doc)
    return out


async def _stream_chat_with_pdf(
    chat_doc: dict, content: str, history: list[dict], excerpt: ExcerptRef | None = None
):
    if excerpt is not None:
        context, page_label = await build_excerpt_context(excerpt.paperId, excerpt.page)
        paper_doc = await papers.find_one({"_id": ObjectId(excerpt.paperId)}, {"title": 1})
        paper_title = paper_doc.get("title", "Untitled") if paper_doc else "Untitled"
        messages = build_excerpt_messages(excerpt.quote, context, page_label, paper_title, history, content)
    else:
        source_folder_ids = [str(fid) for fid in chat_doc.get("sourceFolderIds", [])]
        source_paper_ids = [str(pid) for pid in chat_doc.get("sourcePaperIds", [])]
        context, sources = await build_context(source_folder_ids, source_paper_ids, content)
        messages = build_messages(context, sources, history, content)

    async for event in stream_chat_completion(messages):
        payload = json.loads(event[len("data: ") : -2])
        if payload.get("done"):
            await _append_message(chat_doc["_id"], {"role": "assistant", "content": payload["content"]})
        yield event


async def _stream_chat_with_book(
    chat_doc: dict, content: str, history: list[dict], excerpt: ExcerptRef | None = None
):
    book_id = str(chat_doc["sourceBookId"])
    event_stream = (
        run_book_excerpt_chat(book_id, excerpt.page, excerpt.quote, content, history)
        if excerpt is not None
        else run_book_chat(book_id, content, history)
    )
    async for event in event_stream:
        payload = json.loads(event[len("data: ") : -2])
        if payload.get("done"):
            await _append_message(chat_doc["_id"], {"role": "assistant", "content": payload["content"]})
        yield event


async def _stream_image_excerpt(chat_doc: dict, content: str, history: list[dict], page: int, image_base64: str):
    """Shared by both `chat_with_pdf` and `chat_with_book` — the vision call itself
    doesn't differ by source type, only which local-context helper builds the
    surrounding text. Deliberately non-agentic (no `search_book`/cross-chapter reach)
    per the confirmed v1 scope.
    """
    chat_type = chat_doc.get("type")
    if chat_type == ChatType.chat_with_book.value:
        book_id = str(chat_doc["sourceBookId"])
        local_context, page_label = await build_book_local_context(book_id, page)
        book_doc = await books.find_one({"_id": ObjectId(book_id)}, {"title": 1})
        source_title = book_doc.get("title", "Untitled") if book_doc else "Untitled"
    else:
        source_paper_ids = chat_doc.get("sourcePaperIds", [])
        paper_id = str(source_paper_ids[0]) if source_paper_ids else None
        if paper_id:
            local_context, page_label = await build_excerpt_context(paper_id, page)
            paper_doc = await papers.find_one({"_id": ObjectId(paper_id)}, {"title": 1})
            source_title = paper_doc.get("title", "Untitled") if paper_doc else "Untitled"
        else:
            local_context, page_label, source_title = "", f"p.{page}", "Untitled"

    messages = build_image_messages(image_base64, local_context, page_label, source_title, history, content)

    async for event in stream_chat_completion(messages):
        payload = json.loads(event[len("data: ") : -2])
        if payload.get("done"):
            await _append_message(chat_doc["_id"], {"role": "assistant", "content": payload["content"]})
        yield event


async def _stream_search(chat_doc: dict, content: str):
    search_scope = chat_doc.get("searchScope")
    if search_scope == SearchScope.reference_manager.value:
        source_folder_ids = [str(fid) for fid in chat_doc.get("sourceFolderIds", [])]
        source_paper_ids = [str(pid) for pid in chat_doc.get("sourcePaperIds", [])]
        results = await run_library_search(source_folder_ids, source_paper_ids, content, settings.search_result_limit)
    elif search_scope == SearchScope.arxiv.value:
        results = await run_search(content, providers=["arxiv"])
    else:
        results = await run_search(content)
    results_payload = [
        {
            "title": r.title,
            "authors": r.authors,
            "year": r.year,
            "venue": r.venue,
            "abstract": r.abstract,
            "doi": r.doi,
            "url": r.url,
            "pdfUrl": r.pdfUrl,
            "citationCount": r.citationCount,
            "source": r.source,
        }
        for r in results
    ]
    yield f"data: {json.dumps({'output': {'kind': 'papers', 'results': results_payload}})}\n\n"

    messages = build_search_summary_messages(content, results)
    async for event in stream_chat_completion(messages):
        payload = json.loads(event[len("data: ") : -2])
        if payload.get("done"):
            await _append_message(
                chat_doc["_id"],
                {
                    "role": "assistant",
                    "content": payload["content"],
                    "output": {"kind": "papers", "results": results_payload},
                },
            )
        yield event


async def _stream_deep_research_followup(chat_doc: dict, content: str, history: list[dict]):
    report_markdown = None
    for msg in reversed(chat_doc.get("messages", [])):
        output = msg.get("output")
        if output and output.get("kind") == "document":
            report_markdown = output["markdown"]
            break

    system_content = (
        "Answer the user's question using only the Deep Research Report below.\n\n"
        f"{report_markdown or 'No report content available.'}"
    )
    messages = [{"role": "system", "content": system_content}]
    messages.extend({"role": m["role"], "content": m["content"]} for m in history)
    messages.append({"role": "user", "content": content})

    async for event in stream_chat_completion(messages):
        payload = json.loads(event[len("data: ") : -2])
        if payload.get("done"):
            await _append_message(chat_doc["_id"], {"role": "assistant", "content": payload["content"]})
        yield event


async def _append_message(chat_id: ObjectId, message: dict) -> None:
    message["createdAt"] = utcnow()
    await chats.update_one(
        {"_id": chat_id}, {"$push": {"messages": message}, "$set": {"updatedAt": utcnow()}}
    )


@router.post("/{chat_id}/messages")
async def send_message(chat_id: str, body: MessageCreate):
    chat_doc = await chats.find_one({"_id": ObjectId(chat_id)})
    if not chat_doc:
        raise HTTPException(404, "Chat not found")

    history = chat_doc.get("messages", [])
    is_first_message = len(history) == 0
    user_message: dict = {"role": "user", "content": body.content}
    if body.excerpt:
        user_message["excerpt"] = body.excerpt.model_dump()
    image_base64: str | None = None
    if body.imageExcerpt:
        # The raw base64 crop is only needed for the outgoing OpenAI vision call —
        # never persisted to Mongo. The message stores a served file path instead,
        # same reasoning as PDFs never being inlined into a document.
        image_base64 = body.imageExcerpt.imageBase64
        image_path = save_image_base64(image_base64)
        user_message["imageExcerpt"] = {"page": body.imageExcerpt.page, "imagePath": image_path}
    await _append_message(chat_doc["_id"], user_message)

    chat_type = chat_doc.get("type", ChatType.chat_with_pdf.value)

    if body.imageExcerpt and image_base64:
        event_stream = _stream_image_excerpt(chat_doc, body.content, history, body.imageExcerpt.page, image_base64)
    elif chat_type == ChatType.deep_research.value and is_first_message:
        if chat_doc.get("deepResearchMode") == DeepResearchMode.openai.value:
            event_stream = run_openai_deep_research(chat_id, body.content)
        else:
            scope = DeepResearchScope(chat_doc["deepResearchScope"])
            folder_ids = chat_doc.get("sourceFolderIds", [])
            folder_id = str(folder_ids[0]) if folder_ids else None
            event_stream = run_deep_research_pipeline(chat_id, body.content, scope, folder_id)
    elif chat_type == ChatType.deep_research.value:
        event_stream = _stream_deep_research_followup(chat_doc, body.content, history)
    elif chat_type == ChatType.search.value:
        event_stream = _stream_search(chat_doc, body.content)
    elif chat_type == ChatType.chat_with_book.value:
        event_stream = _stream_chat_with_book(chat_doc, body.content, history, body.excerpt)
    else:
        event_stream = _stream_chat_with_pdf(chat_doc, body.content, history, body.excerpt)

    return StreamingResponse(event_stream, media_type="text/event-stream")
