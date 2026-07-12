IMAGE_SYSTEM_PROMPT = """You are a research assistant helping a user understand an image
region they selected while reading a document. Use the image itself plus the surrounding text
context below to answer. If the context is insufficient to answer, say so explicitly rather
than guessing or using outside knowledge. Always use $...$ for inline math and $$...$$ for
display math. Never use \\( \\) or \\[ \\] delimiters."""


def to_data_url(image_base64: str) -> str:
    if image_base64.strip().lower().startswith("data:"):
        return image_base64
    return f"data:image/png;base64,{image_base64}"


def build_image_messages(
    image_base64: str,
    local_context: str,
    page_label: str,
    source_title: str,
    history: list[dict],
    user_message: str,
) -> list[dict]:
    system_content = (
        f"{IMAGE_SYSTEM_PROMPT}\n\nSource: {source_title}\n\n"
        f"Surrounding text context ({page_label}):\n{local_context or '(none found)'}"
    )
    messages = [{"role": "system", "content": system_content}]
    messages.extend({"role": m["role"], "content": m["content"]} for m in history)
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_message},
                {"type": "image_url", "image_url": {"url": to_data_url(image_base64)}},
            ],
        }
    )
    return messages
