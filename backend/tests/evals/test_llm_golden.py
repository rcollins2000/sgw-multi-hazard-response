"""Golden-set eval for the platform's LLM-facing capabilities.

These tests hit the REAL LLM (whichever provider `LLM_PROVIDER` selects) and
assert on the SHAPE + INVARIANTS of the response — not on the exact prose,
which is non-deterministic. They exist to catch:

    · A prompt version bump that silently breaks the schema contract.
    · A provider swap that produces a subtly different response shape.
    · A model upgrade that starts emitting extra fields the parser drops.

Not a quality test — quality is measured in Governance metrics (fairness,
calibration, coverage). This test is a *contract-stability gate*.

Skipped automatically when no LLM API key is set — CI runs it, local dev
without keys doesn't fail.

Convention: every test function is pinned to a prompt version constant so
a rewrite forces an explicit test update, not a silent regression.
"""

from __future__ import annotations

import os

import pytest

from sgw_platform.explain.prompt_versions import (
    BRIEFING_V,
    EXPLANATION_V,
    SCENARIO_PARSER_V,
)
from sgw_platform.explain.provider import get_provider
from sgw_platform.explain.explanation import ExplanationContext, generate_explanation
from sgw_platform.explain.briefing import BriefingContext, generate_briefing
from sgw_platform.scenarios.parser import parse_directive
from sgw_platform.scenarios.spec import ScenarioSpec
from sgw_platform.settings import get_settings

# Skip everything if no LLM key is available. Reads through pydantic-settings
# so the .env-loaded key is visible (matches how production code sees it).
def _no_llm_key() -> bool:
    s = get_settings()
    return not (s.ollama_api_key or s.openai_api_key)


skip_no_llm = pytest.mark.skipif(_no_llm_key(), reason="No LLM API key configured (.env or env)")


# --------------------------------------------------------------------------- #
# Scenario parser — natural language → ScenarioSpec
# --------------------------------------------------------------------------- #


@skip_no_llm
@pytest.mark.asyncio
async def test_parser_extracts_hurricane_severity() -> None:
    """A directive naming a specific storm category must parse to a
    hurricane spec with the matching severity."""
    spec = await parse_directive("What if a Cat 4 hurricane hit Charleston in 3 weeks?")
    assert spec.kind in ("synthesised", "replay")
    assert spec.hazard_type == "hurricane"
    assert spec.severity == "cat_4"
    # Pinned to the current parser prompt version — if this test starts
    # failing, either the model changed behaviour or the prompt was rewritten.
    assert SCENARIO_PARSER_V == "sp-v2"


@skip_no_llm
@pytest.mark.asyncio
async def test_parser_recognises_worst_case_cascade_kind() -> None:
    """The 'worst single-asset cascade' phrasing must route to the
    dedicated `worst_case_cascade` kind, not a generic synthesised run."""
    spec = await parse_directive("Show me the worst single-asset cascade under baseline conditions.")
    assert spec.kind == "worst_case_cascade"
    # Severity + hazard are unset for cascade kind — the runner uses baseline.
    assert spec.severity is None or spec.severity == ""


@skip_no_llm
@pytest.mark.asyncio
async def test_parser_picks_path_template_from_directional_cue() -> None:
    """A directive naming a real historic storm must populate
    `path_template_hint` from the fixed enum, not invent a value."""
    spec = await parse_directive("Replay Hurricane Matthew against today's assets.")
    valid_hints = {
        None,
        "hurricane_idalia_2023",
        "hurricane_debby_2024",
        "hurricane_matthew_2016",
        "hurricane_michael_2018",
        "cat3_charleston_30d",
    }
    assert spec.path_template_hint in valid_hints
    # Even if the LLM doesn't pick matthew_2016 specifically, it MUST be
    # from the bounded enum — this is the anti-hallucination invariant.


# --------------------------------------------------------------------------- #
# Executive briefing — schema contract stability
# --------------------------------------------------------------------------- #


@skip_no_llm
@pytest.mark.asyncio
async def test_briefing_produces_all_required_sections() -> None:
    """The briefing schema is the contract with the exec deck. If a
    section starts coming back empty, the deck breaks silently."""
    ctx = BriefingContext(
        active_alert_count=6,
        critical_assets=3,
        high_assets=12,
        total_service_population_at_risk=250_000,
        top_risks=[
            {
                "asset_id": "SGW-ELE-CO0031",
                "asset_type_label": "Electrical Substation",
                "region_label": "Coastal East (SC)",
                "risk_score": 0.85,
                "service_population": 119_825,
                "within_hurricane_cone": True,
            },
        ],
        active_hazard_types=["hurricane"],
        model_version="lgbm-reg-v2-hurricane",
        recorded_audit_actions=[
            {
                "user": "operator",
                "action": "accept",
                "subject_id": "SGW-ELE-CO0031",
                "reason": None,
                "timestamp": "2026-07-20T08:00:00Z",
            }
        ],
        cone_asset_count=45,
        cone_note="45 assets in the NHC forecast cone",
    )
    briefing = await generate_briefing(ctx)
    # Contract assertions — every section must be non-empty.
    assert briefing.headline
    assert briefing.situation_summary
    assert len(briefing.top_risks) >= 1
    assert len(briefing.recommended_actions) >= 1
    assert briefing.outlook
    assert BRIEFING_V == "brief-v3"


# --------------------------------------------------------------------------- #
# Asset explanation — evidence citation stability
# --------------------------------------------------------------------------- #


@skip_no_llm
@pytest.mark.asyncio
async def test_explanation_returns_reasoning_and_evidence() -> None:
    """The explanation schema requires reasoning_summary and cited
    evidence IDs. Both must be populated for downstream UI + audit."""
    ctx = ExplanationContext(
        asset_id="SGW-ELE-CO0031",
        asset_name="Coastal East (SC) Electrical Substation 032",
        asset_type="electrical_substation",
        region="COAST_EAST",
        service_population=119_825,
        risk_score=0.74,
        contributing_factors={
            "min_dist_to_surge_zone_m": 274.9,
            "condition_score": 41,
            "ground_elevation_ft": 11.4,
            "criticality_rating": 5,
            "within_hurricane_cone": True,
        },
        evidence={
            "alerts": ["urn:oid:NWS-STORM-SURGE-001"],
            "work_orders": ["WO-COA-EL-00042"],
            "cascade": ["SGW-DIS-CO0005"],
        },
    )
    result = await generate_explanation(ctx)
    assert result.risk_level in ("low", "moderate", "high", "critical")
    assert result.recommended_action
    assert len(result.reasoning_summary) >= 1
    # Anti-hallucination invariant: every cited evidence ID must be one
    # we handed the LLM. Otherwise it invented a source.
    allowed = {
        "urn:oid:NWS-STORM-SURGE-001",
        "WO-COA-EL-00042",
        "SGW-DIS-CO0005",
        "SGW-ELE-CO0031",
    }
    for eid in result.evidence:
        assert eid in allowed, f"LLM cited invented evidence: {eid}"
    assert EXPLANATION_V == "expl-v4"


# --------------------------------------------------------------------------- #
# Cross-cutting: provider selection matches env
# --------------------------------------------------------------------------- #


def test_provider_matches_env() -> None:
    """`get_provider()` must respect the configured LLM_PROVIDER (from .env
    or process env — read through pydantic-settings, same as prod code)."""
    provider = get_provider()
    settings = get_settings()
    assert provider.provider_name == settings.llm_provider.lower()
