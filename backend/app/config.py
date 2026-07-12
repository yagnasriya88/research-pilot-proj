from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    mongodb_uri: str
    mongodb_db_name: str = "research_pilot"
    openai_api_key: str
    chat_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    embedding_dimensions: int = 1536
    pdf_storage_dir: str = "./data/pdfs"
    chunk_tokens: int = 700
    chunk_overlap_tokens: int = 100
    top_k_per_paper: int = 5
    full_text_fallback_token_threshold: int = 6000
    full_text_fallback_max_papers: int = 3
    per_paper_retrieval_max_papers: int = 6
    global_retrieval_top_n: int = 25
    search_result_limit: int = 20
    deep_research_screen_keep: int = 15
    deep_research_openai_model: str = "o4-mini-deep-research"
    cors_origins: str = "http://localhost:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]


settings = Settings()
