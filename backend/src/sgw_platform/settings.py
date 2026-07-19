"""Runtime settings — loaded from environment via pydantic-settings.

Looks for `.env` in these locations, first match wins:
  1. current working directory
  2. project root (parent of `backend/`)
  3. explicit path in `ENV_FILE` env var
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).resolve().parents[2]  # backend/
_PROJECT_ROOT = _BACKEND_ROOT.parent  # technical_challenge/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            Path(".env"),
            _PROJECT_ROOT / ".env",
        ),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Database
    database_url: str = Field(
        default="postgresql+asyncpg://sgw:sgw_dev_only@localhost:5432/sgw"
    )
    database_echo: bool = Field(default=False)

    # LLM provider — "ollama" (Cloud) is the default; "openai" is the fallback path.
    llm_provider: str = Field(default="ollama")

    # Ollama Cloud
    ollama_api_key: str | None = Field(default=None)
    ollama_host: str = Field(default="https://ollama.com")
    ollama_model: str = Field(default="gpt-oss:120b")

    # OpenAI (fallback provider)
    openai_api_key: str | None = Field(default=None)
    openai_model: str = Field(default="gpt-5.6")

    # Logging
    log_level: str = Field(default="INFO")
    log_format: str = Field(default="json")

    # NOAA
    noaa_cache_dir: Path = Field(default=Path("./data/cache/noaa"))
    noaa_coops_station_primary: str = Field(default="8665530")  # Charleston Harbor
    noaa_coops_station_inland: str = Field(default="8720030")

    # Backend
    backend_host: str = Field(default="0.0.0.0")
    backend_port: int = Field(default=8000)
    backend_cors_origins: str = Field(default="http://localhost:5173")

    # Feature flags
    feature_llm_enabled: bool = Field(default=True)

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.backend_cors_origins.split(",")]


_settings: Settings | None = None


def get_settings() -> Settings:
    """Cached singleton — safe across an async process."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
