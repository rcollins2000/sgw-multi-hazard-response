"""Provider abstraction — Ollama primary, OpenAI fallback.

Both implement the LLMProvider protocol. Factory picks based on `LLM_PROVIDER`
env var (default: ollama).

Every structured call gets an audit-log row so the exact `(provider, model,
prompt_version, features_hash)` behind any recommendation is recoverable
weeks later. See `explain/prompt_versions.py` for the versioning contract.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any, Protocol

from pydantic import BaseModel, ValidationError

from sgw_platform.explain.prompt_versions import get_version
from sgw_platform.observability.logging import get_logger
from sgw_platform.observability.metrics import openai_tokens_total
from sgw_platform.settings import get_settings

log = get_logger("llm")


def _prompt_hash(system: str, user: str) -> str:
    """SHA-256 of the exact prompt payload — for audit trail. Truncated to
    16 hex chars to keep the audit row compact; full hash reproducible from
    the raw text on demand."""
    h = hashlib.sha256()
    h.update(system.encode("utf-8"))
    h.update(b"\x1f")  # unit separator — keeps sys/user boundary detectable
    h.update(user.encode("utf-8"))
    return h.hexdigest()[:16]


async def _record_llm_call(
    provider: str,
    model: str,
    capability: str,
    schema_name: str,
    prompt_hash: str,
    outcome: str,
    tokens_out: int,
) -> None:
    """Append a `llm_call` row to the audit log.

    Non-blocking: if the DB is unreachable we log a warning and continue —
    an LLM call succeeding but its audit row failing must not break the
    end-user request. The append-only trigger + hash chain live in the
    audit table itself; this function is just the writer for the LLM
    class of action."""
    try:
        from sgw_platform.audit.writer import append as audit_append
        from sgw_platform.db.session import session_scope

        version = get_version(capability)
        async with session_scope() as session:
            await audit_append(
                session,
                user="system",
                action_type="llm_call",
                subject_id=capability,
                payload={
                    "provider": provider,
                    "model": model,
                    "schema": schema_name,
                    "outcome": outcome,
                    "tokens_out_est": tokens_out,
                },
                model_version=f"{provider}:{model}",
                prompt_version=version,
                features_hash=prompt_hash,
            )
    except Exception as exc:  # noqa: BLE001 — audit failure must never break UX
        log.warning("llm.audit_write_failed", error=str(exc)[:200])


class LLMProvider(Protocol):
    provider_name: str
    model: str

    async def chat_structured(
        self,
        schema: type[BaseModel],
        system: str,
        user: str,
        max_retries: int = 1,
        capability: str = "unversioned",
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
        capability: str = "unversioned",
    ) -> BaseModel:
        json_schema = schema.model_json_schema()
        schema_reminder = (
            f"\n\nReturn a JSON object matching EXACTLY this schema (no other fields):\n"
            f"{json.dumps(json_schema)}"
        )
        prompt_hash = _prompt_hash(system + schema_reminder, user)

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
                tokens_out = len(content) // 4
                openai_tokens_total.labels(direction="out", model=self.model).inc(tokens_out)
                result = schema.model_validate_json(content)
                await _record_llm_call(
                    self.provider_name, self.model, capability, schema.__name__,
                    prompt_hash, "ok", tokens_out,
                )
                return result
            except (ValidationError, json.JSONDecodeError) as exc:
                last_error = exc
                log.warning("llm.validation_failed", attempt=attempt, error=str(exc)[:200])
                if attempt < max_retries:
                    # Add corrective feedback on retry
                    user = user + (
                        f"\n\nYour previous response failed validation with: {exc}. "
                        "Return only the JSON object matching the schema."
                    )
        await _record_llm_call(
            self.provider_name, self.model, capability, schema.__name__,
            prompt_hash, "failed", 0,
        )
        raise RuntimeError(f"LLM produced invalid output after {max_retries + 1} attempts: {last_error}")


def _openai_supports_temperature(model: str) -> bool:
    """Newer OpenAI reasoning models (o1/o3/o4/gpt-5.x) reject any non-default
    `temperature`. Everything else accepts temperature=0 for deterministic output."""
    m = model.lower()
    return not (m.startswith(("o1", "o3", "o4", "gpt-5")) or "-terra" in m or "-mini" in m)


def _openai_strictify_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """OpenAI strict json_schema has three requirements Pydantic v2 doesn't
    satisfy out of the box:

      1. Every object must declare `additionalProperties: false`.
      2. Every property must be listed in `required` (no partial requireds).
      3. "Optional" fields become nullable unions — `{ "type": ["string", "null"] }`.

    This walks the schema recursively and enforces all three so any Pydantic
    model can be handed to OpenAI's strict mode without special-casing at
    the call site.
    """

    def _walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" and "properties" in node:
                node["additionalProperties"] = False
                props = node["properties"]
                # Make every property required (strict mode demands this).
                # Then convert "missing from required" into a nullable union.
                existing_required = set(node.get("required", []))
                for prop_name, prop_schema in props.items():
                    if prop_name not in existing_required and isinstance(prop_schema, dict):
                        _make_nullable(prop_schema)
                node["required"] = list(props.keys())
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for item in node:
                _walk(item)

    def _make_nullable(prop: dict[str, Any]) -> None:
        """Turn an optional property schema into a nullable union.
        Handles the two common Pydantic shapes: plain `{type: X}` and
        `{anyOf: [...]}`."""
        if "anyOf" in prop:
            has_null = any(
                isinstance(opt, dict) and opt.get("type") == "null" for opt in prop["anyOf"]
            )
            if not has_null:
                prop["anyOf"].append({"type": "null"})
            return
        t = prop.get("type")
        if t is None:
            # Untyped (e.g. $ref) — wrap in anyOf with null.
            prop.setdefault("anyOf", []).append({"type": "null"})
            return
        if isinstance(t, list):
            if "null" not in t:
                t.append("null")
            return
        prop["type"] = [t, "null"]

    _walk(schema)
    return schema


class OpenAIProvider:
    """OpenAI provider (default when LLM_PROVIDER=openai)."""

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
        capability: str = "unversioned",
    ) -> BaseModel:
        json_schema = _openai_strictify_schema(schema.model_json_schema())
        prompt_hash = _prompt_hash(system, user)
        # gpt-5.x + reasoning models reject a non-default temperature. Set it
        # only when the model supports it — otherwise let OpenAI apply its own.
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": schema.__name__,
                    "schema": json_schema,
                    "strict": True,
                },
            },
        }
        if _openai_supports_temperature(self.model):
            kwargs["temperature"] = 0.0
        try:
            resp = self._client.chat.completions.create(**kwargs)
            content = resp.choices[0].message.content or ""
            tokens_out = len(content) // 4
            openai_tokens_total.labels(direction="out", model=self.model).inc(tokens_out)
            result = schema.model_validate_json(content)
            await _record_llm_call(
                self.provider_name, self.model, capability, schema.__name__,
                prompt_hash, "ok", tokens_out,
            )
            return result
        except Exception:
            await _record_llm_call(
                self.provider_name, self.model, capability, schema.__name__,
                prompt_hash, "failed", 0,
            )
            raise


def get_provider() -> LLMProvider:
    settings = get_settings()
    provider = settings.llm_provider.lower()
    if provider == "ollama":
        return OllamaProvider()  # type: ignore[return-value]
    if provider == "openai":
        return OpenAIProvider()  # type: ignore[return-value]
    raise ValueError(f"unknown LLM_PROVIDER: {provider}")
