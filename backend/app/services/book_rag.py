import json

from llama_index.core import VectorStoreIndex
from llama_index.core.agent.workflow import AgentStream, FunctionAgent
from llama_index.core.llms import ChatMessage, MessageRole
from llama_index.core.retrievers import AutoMergingRetriever
from llama_index.core.tools import FunctionTool
from llama_index.core.vector_stores import ExactMatchFilter, MetadataFilters
from llama_index.llms.openai import OpenAI

from app.config import settings
from app.services.book_index import (
    get_book_docstore,
    get_book_embed_model,
    get_book_storage_context,
    get_book_vector_store,
)

BOOK_SYSTEM_PROMPT = """You are a research assistant helping a user understand a book.
Answer using the `search_book` tool to find grounding passages — call it as many times as
needed, including for topics that may be covered in a different chapter than the one currently
being discussed. Every factual claim must cite its source using the bracketed label shown with
the excerpt, e.g. [Ch. 3: The Rake, p.42]. If the book's content doesn't contain enough
information to answer, say so explicitly rather than guessing or using outside knowledge.
Always use $...$ for inline math and $$...$$ for display math. Never use \\( \\) or \\[ \\]
delimiters."""

EXCERPT_SYSTEM_PROMPT_PREFIX = """You are a research assistant helping a user understand a
specific passage they selected while reading a book. You've been given their selected quote
plus the local context surrounding it below — answer directly from it when it's sufficient. If
it isn't, use the `search_book` tool to look for the answer elsewhere in the book (e.g. a
different chapter). Cite sources using the bracketed label shown with each excerpt, e.g.
[Ch. 3: The Rake, p.42]. Always use $...$ for inline math and $$...$$ for display math. Never
use \\( \\) or \\[ \\] delimiters.

Selected quote (p.{page}):
"{quote}"

Local context around the selected passage:
{local_context}
"""


def _page_label(meta: dict) -> str:
    start, end = meta.get("startPage"), meta.get("endPage")
    return f"p.{start}" if start == end else f"pp.{start}-{end}"


def _format_nodes(nodes) -> str:
    if not nodes:
        return "No relevant passages found."
    blocks = []
    for n in nodes:
        meta = n.node.metadata
        chapter = meta.get("chapterTitle", "Unknown chapter")
        blocks.append(f"[Ch. {chapter}, {_page_label(meta)}]:\n{n.node.get_content()}")
    return "\n\n---\n\n".join(blocks)


def _book_retriever(book_id: str) -> AutoMergingRetriever:
    embed_model = get_book_embed_model()
    storage_context = get_book_storage_context()
    index = VectorStoreIndex.from_vector_store(get_book_vector_store(), embed_model=embed_model)
    filters = MetadataFilters(filters=[ExactMatchFilter(key="bookId", value=book_id)])
    base_retriever = index.as_retriever(similarity_top_k=settings.book_leaf_retrieval_top_k, filters=filters)
    return AutoMergingRetriever(base_retriever, storage_context=storage_context)


async def build_book_local_context(book_id: str, page: int) -> tuple[str, str]:
    """Non-agentic local-context lookup for a page, used to seed
    `run_book_excerpt_chat` and (separately) image-excerpt questions — finds the leaf
    chunk covering `page`, then returns its merged parent chapter/section text (via the
    docstore's parent relationship, the same node the AutoMergingRetriever would have
    consolidated up to). Mirrors `rag.py::build_excerpt_context`'s section-first
    strategy, adapted to the book's hierarchical node structure.
    """
    from app.db.mongo import book_chunks

    raw = await book_chunks.find_one(
        {
            "metadata.bookId": book_id,
            "metadata.startPage": {"$lte": page},
            "metadata.endPage": {"$gte": page},
        }
    )
    if not raw:
        return "", f"p.{page}"

    docstore = get_book_docstore()
    node = docstore.get_node(str(raw["_id"]))
    parent_rel = node.parent_node
    target = docstore.get_node(parent_rel.node_id) if parent_rel is not None else node

    return target.get_content(), _page_label(target.metadata)


def _search_book_tool(book_id: str) -> FunctionTool:
    retriever = _book_retriever(book_id)

    async def search_book(query: str) -> str:
        nodes = await retriever.aretrieve(query)
        return _format_nodes(nodes)

    return FunctionTool.from_defaults(
        async_fn=search_book,
        name="search_book",
        description=(
            "Search the book for passages relevant to a query. Use this whenever the answer "
            "might live in a chapter other than the one already in view. Returns excerpts with "
            "chapter/page citations."
        ),
    )


def _to_llama_history(history: list[dict]) -> list[ChatMessage]:
    return [
        ChatMessage(role=MessageRole.USER if m["role"] == "user" else MessageRole.ASSISTANT, content=m["content"])
        for m in history
    ]


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _run_agent_stream(agent: FunctionAgent, query: str, history: list[dict]):
    handler = agent.run(user_msg=query, chat_history=_to_llama_history(history))
    async for ev in handler.stream_events():
        if isinstance(ev, AgentStream) and ev.delta:
            yield _sse({"delta": ev.delta})
    result = await handler
    yield _sse({"done": True, "content": result.response.content or ""})


async def run_book_chat(book_id: str, query: str, history: list[dict]):
    """The docked chat's normal path — no starting anchor, the agent decides on its own
    whether/how many times to call `search_book`.
    """
    llm = OpenAI(model=settings.chat_model, api_key=settings.openai_api_key)
    agent = FunctionAgent(tools=[_search_book_tool(book_id)], llm=llm, system_prompt=BOOK_SYSTEM_PROMPT)
    async for event in _run_agent_stream(agent, query, history):
        yield event


async def run_book_excerpt_chat(book_id: str, page: int, quote: str, query: str, history: list[dict]):
    """The Reader's "Ask AI on selection" path — seeded with the passage's local
    chapter/section context up front, so the agent can answer directly when that's
    enough and only reaches for `search_book` (cross-chapter) when it isn't.
    """
    local_context, _ = await build_book_local_context(book_id, page)
    llm = OpenAI(model=settings.chat_model, api_key=settings.openai_api_key)
    system_prompt = EXCERPT_SYSTEM_PROMPT_PREFIX.format(
        page=page, quote=quote, local_context=local_context or "(no local context found)"
    )
    agent = FunctionAgent(tools=[_search_book_tool(book_id)], llm=llm, system_prompt=system_prompt)
    async for event in _run_agent_stream(agent, query, history):
        yield event
