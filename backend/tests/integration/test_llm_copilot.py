"""Phase 5 — LLM copilot integration.

Hits Ollama Cloud with a real request. Skipped automatically if OLLAMA_API_KEY
is not set (CI without credentials).
"""

from __future__ import annotations

import pytest

from sgw_platform.explain.explanation import ExplanationContext, generate_explanation
from sgw_platform.explain.schemas import AssetExplanation
from sgw_platform.settings import get_settings


@pytest.mark.asyncio
async def test_ollama_generates_structured_explanation() -> None:
    if not get_settings().ollama_api_key:
        pytest.skip("OLLAMA_API_KEY not set")

    ctx = ExplanationContext(
        asset_id="SGW-PMP-CO0007",
        asset_name="Marsh Point Pumping Station",
        asset_type="water_pumping_station",
        region="COAST_EAST",
        service_population=184_000,
        risk_score=0.89,
        contributing_factors={
            "criticality_rating": 5,
            "condition_score": 62,
            "flood_zone": "AE",
            "ground_elevation_ft": 11.2,
            "min_dist_to_surge_zone_m": 800,
            "recent_scada_warnings": 4,
            "recent_high_severity_reports": 1,
            "within_hurricane_cone": True,
            "backup_power": "diesel_generator",
        },
        evidence={
            "alerts": ["urn:oid:2.49.0.1.840.0.demo.flash_flood.1"],
            "work_orders": ["WO-98421"],
            "sensor_readings": ["SNS-PMP-CO0007-01"],
            "field_reports": ["FR-55201"],
        },
    )

    result = await generate_explanation(ctx)
    assert isinstance(result, AssetExplanation)
    assert result.asset_id == ctx.asset_id
    assert result.risk_level in {"low", "moderate", "high", "critical"}
    assert len(result.reasoning_summary) >= 1
    # Every cited evidence ID must have been supplied in context
    all_provided_ids = {i for ids in ctx.evidence.values() for i in ids}
    for cited in result.evidence:
        assert cited in all_provided_ids, f"LLM invented evidence ID: {cited}"
