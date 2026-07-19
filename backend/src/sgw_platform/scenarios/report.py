"""LLM-drafted narrative + recommendation for a scenario run.

The LLM sees the ScenarioSpec + top-N ranked impacts and produces two short
prose fields plus a list of cited evidence IDs (asset IDs). Every ID it
cites MUST appear in the ranked_impacts list — enforced downstream when the
report is written to the audit log.

Falls back to a template if the LLM call fails so the endpoint always returns
something renderable.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from sgw_platform.explain.provider import get_provider
from sgw_platform.observability.logging import get_logger
from sgw_platform.scenarios.spec import ScenarioImpact, ScenarioSpec

log = get_logger("scenarios.report")


class _LlmScenarioNarration(BaseModel):
    """LLM-produced narration paired to a ScenarioSpec + impacts."""

    summary: str = Field(
        description="One-paragraph situational summary (3-5 sentences) of what this scenario would look like operationally."
    )
    recommendation: str = Field(
        description="One-sentence imperative recommendation for the operator. Advisory only."
    )
    evidence: list[str] = Field(
        description="Asset IDs cited from the ranked_impacts list. 3-6 items."
    )


SYSTEM_PROMPT = """You are the SGW scenario copilot. You narrate scenario runs for the operator.

You are given a ScenarioSpec + a list of top-N ranked impacts. Produce:
  · summary       — 3-5 sentences, present tense, describe what this scenario would look like operationally
  · recommendation — ONE imperative sentence the operator can act on. Advisory.
  · evidence      — 3-6 asset IDs, taken VERBATIM from the ranked_impacts you were given.

Constraints:
  · Never invent asset IDs. Every evidence entry must appear in the ranked_impacts.
  · Never produce numeric risk scores or forecasts in the summary — refer to them qualitatively.
  · Keep the tone dry, engineering-grade — this is an operational surface, not marketing copy.

Return ONLY the JSON object matching:
{schema}
"""


def _fallback_narration(
    spec: ScenarioSpec, impacts: list[ScenarioImpact]
) -> _LlmScenarioNarration:
    top = impacts[:3]
    ids = [i.asset_id for i in top]
    names = ", ".join(i.asset_name for i in top) or "no assets"
    summary = (
        f"Scenario '{spec.label}' concentrates impact on {names}. "
        f"Under this hypothesis {len(impacts)} assets rank materially above baseline. "
        "Cascading effects propagate through the current dependency graph — see the ranked list for details."
    )
    recommendation = (
        f"Prioritise a preventative review of {top[0].asset_name if top else 'the top-ranked asset'} "
        "and confirm the cascade endpoints before scheduling remediation work."
    )
    return _LlmScenarioNarration(
        summary=summary, recommendation=recommendation, evidence=ids
    )


async def generate(
    spec: ScenarioSpec, impacts: list[ScenarioImpact]
) -> _LlmScenarioNarration:
    """Ask the LLM to narrate the scenario run.

    On any failure, returns a deterministic template so the endpoint keeps working.
    """
    if not impacts:
        return _fallback_narration(spec, impacts)

    provider = get_provider()
    schema = _LlmScenarioNarration.model_json_schema()
    system = SYSTEM_PROMPT.format(schema=schema)

    # Serialise the input the LLM sees. Keep it compact — the LLM only needs
    # the label, kind, top-8 impacts, and a few metadata fields.
    user_payload = {
        "spec": spec.model_dump(mode="json", exclude_none=True),
        "top_impacts": [
            {
                "asset_id": i.asset_id,
                "asset_name": i.asset_name,
                "region": i.region,
                "utility_domain": i.utility_domain,
                "baseline_score": round(i.baseline_score, 3),
                "scenario_score": round(i.scenario_score, 3),
                "delta": round(i.delta, 3),
                "cascade_depth": i.cascade_depth,
            }
            for i in impacts[:8]
        ],
    }
    try:
        result = await provider.chat_structured(
            _LlmScenarioNarration, system, str(user_payload)
        )
        assert isinstance(result, _LlmScenarioNarration)
        # Guard-rail: drop any evidence IDs the LLM invented.
        allowed = {i.asset_id for i in impacts}
        clean_evidence = [e for e in result.evidence if e in allowed]
        if not clean_evidence:
            clean_evidence = [i.asset_id for i in impacts[:3]]
        result = result.model_copy(update={"evidence": clean_evidence})
        log.info(
            "scenarios.report.ok",
            evidence_count=len(clean_evidence),
        )
        return result
    except Exception as exc:  # noqa: BLE001 — deliberate: never let the LLM break the flow
        log.warning("scenarios.report.fallback", error=str(exc))
        return _fallback_narration(spec, impacts)
