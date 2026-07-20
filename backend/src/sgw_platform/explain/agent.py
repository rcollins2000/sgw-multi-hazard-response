"""SGW operational copilot agent — Ollama tool-calling loop with streaming.

The agent has narrowly-scoped tools that read the SGW platform state. It never
mutates without the operator's click — the UI surfaces proposed decisions as
inline buttons that write to the audit log when the operator confirms.

Tools (kept small on purpose — LLM tool-call reliability drops fast past 5):
- lookup_asset(asset_id) → attributes + features + current risk
- cascade_from(asset_id) → downstream dependency chain
- noaa_alerts_now(state?) → active NWS alerts, optionally filtered by state
- model_explainer() → plain-language summary of the risk model + top features + honest caveats
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import text

from sgw_platform.api.state import STATE
from sgw_platform.db.session import session_scope
from sgw_platform.observability.logging import get_logger
from sgw_platform.observability.metrics import openai_tokens_total
from sgw_platform.settings import get_settings

log = get_logger("agent")


# ---------------------------------------------------------------------------
# Tool implementations — each returns a JSON-serialisable dict.
# ---------------------------------------------------------------------------


async def _tool_lookup_asset(asset_id: str) -> dict[str, Any]:
    async with session_scope() as session:
        r = await session.execute(
            text(
                """
                SELECT a.asset_id, a.asset_name, a.asset_type, a.utility_domain, a.region,
                       a.criticality_rating, a.condition_score, a.service_population,
                       a.flood_zone, a.ground_elevation_ft, a.backup_power,
                       ST_Y(a.geom::geometry) AS latitude, ST_X(a.geom::geometry) AS longitude
                FROM assets a WHERE a.asset_id = :id
                """
            ),
            {"id": asset_id},
        )
        row = r.mappings().first()
    if not row:
        return {"error": f"asset not found: {asset_id}"}
    result: dict[str, Any] = dict(row)
    if STATE.features is not None and STATE.scores is not None:
        matches = STATE.features["asset_id"] == asset_id
        if matches.any():
            idx = STATE.features.index[matches][0]
            result["risk_score"] = float(STATE.scores.iloc[idx])
            result["within_hurricane_cone"] = bool(STATE.features.loc[idx, "within_hurricane_cone"])
            result["min_dist_to_surge_zone_m"] = float(STATE.features.loc[idx, "min_dist_to_surge_zone_m"])
            result["recent_scada_warnings"] = int(STATE.features.loc[idx, "recent_scada_warnings"])
            result["overdue_work_orders"] = int(STATE.features.loc[idx, "overdue_work_orders"])
    return result


async def _tool_cascade_from(asset_id: str) -> dict[str, Any]:
    if STATE.dep_graph is None:
        return {"error": "dependency graph not loaded"}
    c = STATE.dep_graph.cascade_from(asset_id, max_depth=3)
    return {
        "root": c.root,
        "downstream_count": len(c.downstream),
        "chain": [
            {"upstream": u, "downstream": d, "consequence": cons}
            for u, d, cons in c.edges
        ],
    }


async def _tool_noaa_alerts_now(state: str | None = None) -> dict[str, Any]:
    async with session_scope() as session:
        q = "SELECT alert_id, hazard_type, severity, headline FROM weather_alerts WHERE expires_at > NOW()"
        params: dict[str, Any] = {}
        if state:
            q += " AND payload::text ILIKE :state_pat"
            params["state_pat"] = f'%{state}%'
        q += " ORDER BY issued_at DESC LIMIT 20"
        r = await session.execute(text(q), params)
        rows = list(r.mappings())
    return {
        "count": len(rows),
        "alerts": [
            {
                "id": row["alert_id"],
                "hazard": row["hazard_type"],
                "severity": row["severity"],
                "headline": row["headline"][:200],
            }
            for row in rows
        ],
    }


async def _tool_model_explainer() -> dict[str, Any]:
    tr = STATE.training_report or {}
    risk = tr.get("risk", {}) if isinstance(tr, dict) else {}
    graph = tr.get("graph", {}) if isinstance(tr, dict) else {}
    return {
        "model_family": "gradient-boosted regressor (LightGBM)",
        "version": risk.get("model_version"),
        "baseline": "Random Forest regressor for comparison",
        "target_source": "synthetic continuous risk probability built from feature signals — replaces real historical incident labels for the fictional SGW dataset",
        "metrics": risk.get("metrics", {}),
        "top_features_by_importance": risk.get("top_features", {}),
        "graph_stats": graph,
        "known_limitations": [
            "Risk labels are synthesised — no real historical failure data for a fictional utility",
            "Historic hurricane cone footprints (Debby 2024, Idalia 2023) are baked into features as stress-test overlays",
            "Small train set (~150 rows); production would use years of real incident joins",
            "Placeholder hazard zone polygons — real Digital Coast / NHC SLOSH clips are a Phase 2 upgrade",
        ],
    }


# ---------------------------------------------------------------------------
# Tool registry — Ollama OpenAI-compatible tool spec.
# ---------------------------------------------------------------------------

TOOL_SPECS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "lookup_asset",
            "description": "Fetch full attributes + current risk features for a specific SGW asset by its canonical asset_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "e.g. SGW-ELE-CO0031"},
                },
                "required": ["asset_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cascade_from",
            "description": "Return the downstream dependency chain for an asset — which other assets would be impacted if this one fails.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "string", "description": "e.g. SGW-ELE-CO0031"},
                },
                "required": ["asset_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "noaa_alerts_now",
            "description": "Fetch currently active NWS alerts. Optionally filter by US state code (SC, GA, NC).",
            "parameters": {
                "type": "object",
                "properties": {
                    "state": {"type": "string", "description": "Two-letter US state, e.g. SC. Optional."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "model_explainer",
            "description": "Plain-language explanation of the risk-scoring model — what it's trained on, feature importances, accuracy, honest caveats. Use when the user asks how the risk score is derived or what the model actually does.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

TOOL_IMPL = {
    "lookup_asset": _tool_lookup_asset,
    "cascade_from": _tool_cascade_from,
    "noaa_alerts_now": _tool_noaa_alerts_now,
    "model_explainer": _tool_model_explainer,
}


SYSTEM_PROMPT = (
    "You are the SGW operational copilot. You help NOC controllers, emergency coordinators, "
    "field supervisors and maintenance planners reason about infrastructure risk during "
    "severe-weather events across coastal SC / GA / NC.\n"
    "\n"
    "Ground rules:\n"
    "- Call tools before stating facts. Never invent an asset ID, alert ID, risk score, or downstream dependency.\n"
    "- When you propose an action, prefix with 'RECOMMENDATION:' followed by the concrete action (e.g. "
    "  'RECOMMENDATION: Accept the pre-position crew action for SGW-ELE-CO0031'). The UI turns this "
    "  into a one-click execute button that writes to the audit log.\n"
    "- Historic hurricane cones (Debby 2024, Idalia 2023) are stress-test overlays baked into the risk "
    "  model — they inflate scores but do NOT mean an active hurricane. Say so when relevant.\n"
    "- If asked about the ML model, call model_explainer(). Then translate the output into plain English "
    "  for a stakeholder who may not be quantitatively literate.\n"
    "- Keep responses short. Operators are scanning under time pressure.\n"
)


# ---------------------------------------------------------------------------
# Streaming agent loop.
# ---------------------------------------------------------------------------


async def stream_agent(
    messages: list[dict[str, Any]],
    asset_context: dict[str, Any] | None = None,
    max_tool_iterations: int = 4,
) -> AsyncIterator[dict[str, Any]]:
    """Yield SSE-shaped dicts: {type, data}.

    Events emitted:
      - {type: "token", data: "..."}         streamed assistant token
      - {type: "tool_call", data: {name, arguments}}
      - {type: "tool_result", data: {name, result}}
      - {type: "final", data: {content}}
      - {type: "error", data: {message}}

    Routes to Ollama or OpenAI based on LLM_PROVIDER. Both share the same
    tool-spec shape, but the tool-call/tool-result message envelopes differ,
    so the loops are separate.
    """
    settings = get_settings()
    if settings.llm_provider == "openai":
        async for evt in _stream_agent_openai(messages, asset_context, max_tool_iterations):
            yield evt
        return

    from ollama import Client

    client = Client(
        host=settings.ollama_host,
        headers={"Authorization": f"Bearer {settings.ollama_api_key or ''}"},
    )

    conversation: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if asset_context is not None:
        conversation.append(
            {
                "role": "system",
                "content": f"Current context — the user is looking at asset {json.dumps(asset_context)}",
            }
        )
    conversation.extend(messages)

    for iteration in range(max_tool_iterations + 1):
        try:
            resp = client.chat(
                model=settings.ollama_model,
                messages=conversation,
                tools=TOOL_SPECS if iteration < max_tool_iterations else None,
                options={"temperature": 0.2, "num_predict": 1500},
                stream=False,
            )
        except Exception as exc:  # noqa: BLE001
            log.error("agent.chat_failed", error=str(exc)[:400])
            yield {"type": "error", "data": {"message": str(exc)[:400]}}
            return

        message = resp.get("message", {}) or {}
        tool_calls = message.get("tool_calls") or []
        content = message.get("content", "") or ""

        # Estimate for observability
        openai_tokens_total.labels(direction="out", model=settings.ollama_model).inc(len(content) // 4)

        if not tool_calls:
            # Final answer — chunk it out as pseudo-streaming for a nicer UX.
            # (Ollama doesn't natively split; we chunk by whitespace.)
            for chunk in _chunk_stream(content):
                yield {"type": "token", "data": chunk}
            yield {"type": "final", "data": {"content": content}}
            return

        # Assistant proposed tool calls — record and execute
        conversation.append({"role": "assistant", "content": content, "tool_calls": tool_calls})
        for tc in tool_calls:
            fn = tc.get("function", {}) or {}
            name = fn.get("name") or ""
            args = fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except Exception:  # noqa: BLE001
                    args = {}
            yield {"type": "tool_call", "data": {"name": name, "arguments": args}}
            impl = TOOL_IMPL.get(name)
            if impl is None:
                result: dict[str, Any] = {"error": f"unknown tool: {name}"}
            else:
                try:
                    result = await impl(**args)
                except TypeError as exc:
                    result = {"error": f"bad arguments for {name}: {exc}"}
                except Exception as exc:  # noqa: BLE001
                    result = {"error": str(exc)[:200]}
            yield {"type": "tool_result", "data": {"name": name, "result": result}}
            conversation.append(
                {
                    "role": "tool",
                    "name": name,
                    "content": json.dumps(result, default=str),
                }
            )

    yield {"type": "error", "data": {"message": "tool-call loop exceeded max iterations"}}


async def _stream_agent_openai(
    messages: list[dict[str, Any]],
    asset_context: dict[str, Any] | None,
    max_tool_iterations: int,
) -> AsyncIterator[dict[str, Any]]:
    """OpenAI variant of the streaming agent — same tool-calling loop as
    Ollama but with OpenAI's message + tool-call envelope shapes. Non-streaming
    for now; we chunk the final content into pseudo-stream tokens so the UI
    can render progressively without needing SSE-native OpenAI plumbing."""
    from openai import OpenAI

    from sgw_platform.explain.provider import _openai_supports_temperature

    settings = get_settings()
    client = OpenAI(api_key=settings.openai_api_key or "")
    model = settings.openai_model

    conversation: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    if asset_context is not None:
        conversation.append(
            {
                "role": "system",
                "content": f"Current context — the user is looking at asset {json.dumps(asset_context)}",
            }
        )
    conversation.extend(messages)

    for iteration in range(max_tool_iterations + 1):
        try:
            kwargs: dict[str, Any] = {
                "model": model,
                "messages": conversation,
            }
            if iteration < max_tool_iterations:
                kwargs["tools"] = TOOL_SPECS
            if _openai_supports_temperature(model):
                kwargs["temperature"] = 0.2
            else:
                # gpt-5.x reasoning models reject function tools unless
                # reasoning is explicitly disabled — same class we detect
                # via the temperature guard.
                kwargs["reasoning_effort"] = "none"
            resp = client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            log.error("agent.openai.chat_failed", error=str(exc)[:400])
            yield {"type": "error", "data": {"message": str(exc)[:400]}}
            return

        message = resp.choices[0].message
        tool_calls = message.tool_calls or []
        content = message.content or ""
        openai_tokens_total.labels(direction="out", model=model).inc(len(content) // 4)

        if not tool_calls:
            for chunk in _chunk_stream(content):
                yield {"type": "token", "data": chunk}
            yield {"type": "final", "data": {"content": content}}
            return

        # Record the assistant tool-call turn — OpenAI needs the full tool_calls
        # array back in the assistant message so tool responses can reference it.
        conversation.append(
            {
                "role": "assistant",
                "content": content or None,
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            }
        )
        for tc in tool_calls:
            name = tc.function.name
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool_call", "data": {"name": name, "arguments": args}}
            impl = TOOL_IMPL.get(name)
            if impl is None:
                result: dict[str, Any] = {"error": f"unknown tool: {name}"}
            else:
                try:
                    result = await impl(**args)
                except TypeError as exc:
                    result = {"error": f"bad arguments for {name}: {exc}"}
                except Exception as exc:  # noqa: BLE001
                    result = {"error": str(exc)[:200]}
            yield {"type": "tool_result", "data": {"name": name, "result": result}}
            conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result, default=str),
                }
            )

    yield {"type": "error", "data": {"message": "tool-call loop exceeded max iterations"}}


def _chunk_stream(text: str, chunk_words: int = 4) -> list[str]:
    words = text.split(" ")
    chunks: list[str] = []
    buf: list[str] = []
    for w in words:
        buf.append(w)
        if len(buf) >= chunk_words:
            chunks.append(" ".join(buf) + " ")
            buf = []
    if buf:
        chunks.append(" ".join(buf))
    return chunks
