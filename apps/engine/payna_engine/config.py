"""Environment configuration for the Payna engine.

Mirrors apps/server/src/config.ts so the Python engine and the TypeScript
server read the *same* Neo4j / Postgres / LLM settings from the repo-root .env.
Fail fast on a missing required var rather than surfacing a cryptic error deep
in a driver call.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root is three levels up from this file: apps/engine/payna_engine/config.py
_REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(_REPO_ROOT / ".env", Path(".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    neo4j_uri: str = Field(..., alias="NEO4J_URI")
    neo4j_user: str = Field(..., alias="NEO4J_USER")
    neo4j_password: str = Field(..., alias="NEO4J_PASSWORD")
    database_url: str = Field(..., alias="DATABASE_URL")

    llm_base_url: str = Field("https://integrate.api.nvidia.com/v1", alias="LLM_BASE_URL")
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    llm_model: str = Field("nvidia/nemotron-3-super-120b-a12b", alias="LLM_MODEL")

    # When true (or no API key present), the extraction agent uses a deterministic
    # local stand-in instead of calling the LLM — keeps demos and CI runnable.
    mock_extraction: bool = Field(False, alias="MOCK_EXTRACTION")

    engine_port: int = Field(4100, alias="ENGINE_PORT")

    @property
    def use_mock(self) -> bool:
        return self.mock_extraction or not self.llm_api_key


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
