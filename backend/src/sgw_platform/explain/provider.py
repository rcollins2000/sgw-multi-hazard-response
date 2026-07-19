"""Provider abstraction — Ollama primary, OpenAI fallback.

Both implement the LLMProvider protocol. Factory picks based on `LLM_PROVIDER`
env var (default: ollama).
"""

from __future__ import annotations

import json
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from sgw_platform.observability.logging import get_logger
from sgw_platform.observability.metrics import openai_tokens_total
from sgw_platform.settings import get_settings

log = get_logger("llm")


class LLMProvider(Protocol):
    provider_name: str
    model: str

    async def chat_structured(
        self,
        schema: type[BaseModel],
        system: str,
        user: str,
        max_retries: int = 1,
    ) -> BaseModel: ...


class OllamaProvider:
    """Ollama Cloud with the schema-in-prompt-AND-format pattern proven in Phase 0."""

    provider_name = "ollama"

    def __init__(self) -> None:
        settings = get_settings()
        from ollama import Client

        self.model = settings.ollama_model
        self._client = Client(
            host=settings.ollama_host,
            headers={"Authorization": f"Bearer {settings.ollama_api_key or ''}"},
        )

    async def chat_structured(
        self,
        schema: type[BaseModel],
        system: str,
        user: str,
        max_retries: int = 1,
    ) -> BaseModel:
        json_schema = schema.model_json_schema()
        schema_reminder = (
            f"\n\nReturn a JSON object matching EXACTLY this schema (no other fields):\n"
            f"{json.dumps(json_schema)}"
        )

        last_error: Exception | None = None
        for attempt in range(max_retries + 1):
            try:
                # Ollama Python client is sync — safe to call from an async context
                resp = self._client.chat(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system + schema_reminder},
                        {"role": "user", "content": user},
                    ],
                    format=json_schema,
                    options={"num_predict": 2000, "temperature": 0.0},
                    stream=False,
                )
                content: str = resp["message"]["content"]
                # Estimate tokens for observability (approximate)
                openai_tokens_total.labels(direction="out", model=self.model).inc(len(content) // 4)
                return schema.model_validate_json(content)
            except (ValidationError, json.JSONDecodeError) as exc:
                last_error = exc
                log.warning("llm.validation_failed", attempt=attempt, error=str(exc)[:200])
                if attempt < max_retries:
                    # Add corrective feedback on retry
                    user = user + (
                        f"\n\nYour previous response failed validation with: {exc}. "
                        "Return only the JSON object matching the schema."
                    )
        raise RuntimeError(f"LLM produced invalid output after {max_retries + 1} attempts: {last_error}")


class OpenAIProvider:
    """OpenAI fallback (unused in MVP; wired for parity)."""

    provider_name = "openai"

    def __init__(self) -> None:
        from openai import OpenAI

        settings = get_settings()
        self.model = settings.openai_model
        self._client = OpenAI(api_key=settings.openai_api_key or "")

    async def chat_structured(
        self,
        schema: type[BaseModel],
        system: str,
        user: str,
        max_retries: int = 1,
    ) -> BaseModel:
        json_schema = schema.model_json_schema()
        resp = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "schema": json_schema,
                    "strict": True,
                },
            },
            temperature=0.0,
        )
        content = resp.choices[0].message.content or ""
        openai_tokens_total.labels(direction="out", model=self.model).inc(len(content) // 4)
        return schema.model_validate_json(content)


def get_provider() -> LLMProvider:
    settings = get_settings()
    provider = settings.llm_provider.lower()
    if provider == "ollama":
        return OllamaProvider()  # type: ignore[return-value]
    if provider == "openai":
        return OpenAIProvider()  # type: ignore[return-value]
    raise ValueError(f"unknown LLM_PROVIDER: {provider}")
