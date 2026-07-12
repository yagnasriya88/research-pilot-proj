import json
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.config import settings

_openai = AsyncOpenAI(api_key=settings.openai_api_key)


async def stream_chat_completion(messages: list[dict]) -> AsyncGenerator[str, None]:
    """Yields Server-Sent Events. Each token delta is sent as {"delta": "..."},
    followed by a final {"done": true, "content": "<full text>"} event.
    """
    full_text = ""
    stream = await _openai.chat.completions.create(
        model=settings.chat_model,
        messages=messages,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content if chunk.choices else None
        if delta:
            full_text += delta
            yield f"data: {json.dumps({'delta': delta})}\n\n"

    yield f"data: {json.dumps({'done': True, 'content': full_text})}\n\n"
