from app.services.search_providers import NormalizedResult

SEARCH_SUMMARY_SYSTEM_PROMPT = """You are a research assistant. Given a user's research
question and a ranked list of papers found for it, write a short (2-4 sentence) synthesized
answer to their question, grounded only in the papers listed. Cite papers inline using their
bracketed number, e.g. [1], [3]. If the papers don't clearly answer the question, say what
they do cover instead."""


def build_search_summary_messages(query: str, results: list[NormalizedResult]) -> list[dict]:
    listing = "\n\n".join(
        f"[{i + 1}] {r.title} ({r.year or 'n.d.'}) - {r.citationCount or 0} citations\n"
        f"{(r.abstract or 'No abstract available.')[:500]}"
        for i, r in enumerate(results)
    )
    user_content = f"Question: {query}\n\nPapers found:\n\n{listing}"
    return [
        {"role": "system", "content": SEARCH_SUMMARY_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]
