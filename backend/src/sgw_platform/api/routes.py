"""Operational API routes — the frontend consumes these."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from sgw_platform.api.state import STATE
from sgw_platform.audit.writer import append as audit_append
from sgw_platform.db.session import session_scope
from sgw_platform.explain.agent import stream_agent
from sgw_platform.explain.briefing import BriefingContext, generate_briefing
from sgw_platform.explain.explanation import ExplanationContext, generate_explanation
from sgw_platform.governance.fairness import audit as fairness_audit
from sgw_platform.models.risk import synthesise_labels
from sgw_platform.observability.logging import get_logger
from sgw_platform.scenarios import ScenarioReport
from sgw_platform.scenarios.parser import PRESET_SPECS, parse_directive
from sgw_platform.scenarios.report import generate as generate_scenario_narration
from sgw_platform.scenarios.runner import run as run_scenario
from sgw_platform.scenarios.spec import ScenarioRequest, ScenarioSpec

log = get_logger("api")
router = APIRouter()


# ------------------------------ pydantic request/response ------------------------------


class AssetSummary(BaseModel):
    asset_id: str
    asset_name: str
    asset_type: str
    utility_domain: str
    region: str
    latitude: float
    longitude: float
    criticality_rating: int
    service_population: int | None
    risk_score: float
    risk_level: str
    blast_radius_cluster: int | None
    within_hurricane_cone: bool


class AssetDetail(AssetSummary):
    condition_score: int | None
    flood_zone: str | None
    ground_elevation_ft: float | None
    backup_power: str | None
    features: dict[str, Any]
    cascade: list[dict[str, Any]]
    evidence: dict[str, list[str]]


class DecisionIn(BaseModel):
    prediction_id: int | None = None
    asset_id: str
    action: str  # accept | override | comment
    reason: str | None = None
    user: str = "operator"


# ------------------------------ helpers ------------------------------


def _level_of(score: float) -> str:
    if score >= 0.80:
        return "critical"
    if score >= 0.60:
        return "high"
    if score >= 0.40:
        return "moderate"
    return "low"


def _ensure_ready() -> None:
    if not STATE.ready:
        raise HTTPException(status_code=503, detail=f"platform not ready: {STATE.error or 'training in progress'}")


# ------------------------------ endpoints ------------------------------


@router.get("/api/status")
async def status() -> dict[str, Any]:
    return {
        "ready": STATE.ready,
        "error": STATE.error,
        "training_report": STATE.training_report,
    }


@router.get("/api/assets", response_model=list[AssetSummary])
async def list_assets(
    region: str | None = None,
    limit: int = Query(500, le=1000),
    min_risk: float = 0.0,
) -> list[AssetSummary]:
    _ensure_ready()
    async with session_scope() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    a.asset_id, a.asset_name, a.asset_type, a.utility_domain, a.region,
                    a.criticality_rating, a.service_population,
                    ST_Y(a.geom::geometry) AS latitude,
                    ST_X(a.geom::geometry) AS longitude
                FROM assets a
                WHERE (CAST(:region AS text) IS NULL OR a.region = CAST(:region AS text))
                """
            ),
            {"region": region},
        )
        rows = list(result.mappings())

    scores = STATE.scores
    clusters = STATE.blast_radius.cluster_assignment if STATE.blast_radius else {}
    features = STATE.features
    cone_flags = {}
    if features is not None:
        cone_flags = dict(zip(features["asset_id"], features["within_hurricane_cone"].astype(bool), strict=True))
    score_map = {}
    if scores is not None and features is not None:
        score_map = dict(zip(features["asset_id"], scores.astype(float), strict=True))

    out: list[AssetSummary] = []
    for r in rows:
        s = float(score_map.get(r["asset_id"], 0.0))
        if s < min_risk:
            continue
        out.append(
            AssetSummary(
                asset_id=r["asset_id"],
                asset_name=r["asset_name"],
                asset_type=r["asset_type"],
                utility_domain=r["utility_domain"],
                region=r["region"],
                latitude=r["latitude"],
                longitude=r["longitude"],
                criticality_rating=r["criticality_rating"],
                service_population=r["service_population"],
                risk_score=s,
                risk_level=_level_of(s),
                blast_radius_cluster=clusters.get(r["asset_id"]),
                within_hurricane_cone=bool(cone_flags.get(r["asset_id"], False)),
            )
        )
    out.sort(key=lambda a: a.risk_score, reverse=True)
    return out[:limit]


async def _gather_evidence(session, asset_id: str) -> dict[str, list[str]]:
    evidence: dict[str, list[str]] = {"alerts": [], "work_orders": [], "sensor_readings": [], "field_reports": []}

    r = await session.execute(
        text(
            "SELECT alert_id FROM weather_alerts "
            "WHERE expires_at > NOW() LIMIT 3"
        )
    )
    evidence["alerts"] = [row[0] for row in r]

    r = await session.execute(
        text(
            "SELECT work_order_id FROM work_orders "
            "WHERE asset_id = :a AND status IN ('Overdue', 'In progress') "
            "ORDER BY created_at_source DESC LIMIT 3"
        ),
        {"a": asset_id},
    )
    evidence["work_orders"] = [row[0] for row in r]

    r = await session.execute(
        text(
            "SELECT DISTINCT sensor_id FROM sensor_readings "
            "WHERE asset_id = :a AND quality_flag IN ('Warning', 'Outlier', 'Sensor fault') "
            "LIMIT 3"
        ),
        {"a": asset_id},
    )
    evidence["sensor_readings"] = [row[0] for row in r]

    r = await session.execute(
        text(
            "SELECT report_id FROM field_reports "
            "WHERE asset_id = :a AND severity IN ('High', 'Critical') "
            "ORDER BY submitted_at DESC LIMIT 3"
        ),
        {"a": asset_id},
    )
    evidence["field_reports"] = [row[0] for row in r]

    return evidence


@router.get("/api/assets/{asset_id}", response_model=AssetDetail)
async def get_asset(asset_id: str) -> AssetDetail:
    _ensure_ready()
    async with session_scope() as session:
        result = await session.execute(
            text(
                """
                SELECT
                    a.asset_id, a.asset_name, a.asset_type, a.utility_domain, a.region,
                    a.criticality_rating, a.condition_score, a.service_population,
                    a.flood_zone, a.ground_elevation_ft, a.backup_power,
                    ST_Y(a.geom::geometry) AS latitude,
                    ST_X(a.geom::geometry) AS longitude
                FROM assets a WHERE a.asset_id = :id
                """
            ),
            {"id": asset_id},
        )
        row = result.mappings().first()
        if not row:
            raise HTTPException(status_code=404, detail="asset not found")
        evidence = await _gather_evidence(session, asset_id)

    features = STATE.features
    scores = STATE.scores
    dep_graph = STATE.dep_graph
    clusters = STATE.blast_radius.cluster_assignment if STATE.blast_radius else {}

    feat_row: dict[str, Any] = {}
    score = 0.0
    if features is not None and scores is not None and asset_id in set(features["asset_id"]):
        idx = features.index[features["asset_id"] == asset_id][0]
        feat_row = features.loc[idx].to_dict()
        score = float(scores.iloc[idx])

    cascade = []
    if dep_graph is not None:
        c = dep_graph.cascade_from(asset_id, max_depth=3)
        cascade = [{"downstream": t, "depth": c.depth_map[t], "consequence": cons} for _, t, cons in c.edges]

    return AssetDetail(
        asset_id=row["asset_id"],
        asset_name=row["asset_name"],
        asset_type=row["asset_type"],
        utility_domain=row["utility_domain"],
        region=row["region"],
        latitude=row["latitude"],
        longitude=row["longitude"],
        criticality_rating=row["criticality_rating"],
        service_population=row["service_population"],
        condition_score=row["condition_score"],
        flood_zone=row["flood_zone"],
        ground_elevation_ft=row["ground_elevation_ft"],
        backup_power=row["backup_power"],
        risk_score=score,
        risk_level=_level_of(score),
        blast_radius_cluster=clusters.get(asset_id),
        within_hurricane_cone=bool(feat_row.get("within_hurricane_cone", 0)),
        features={k: v for k, v in feat_row.items() if k != "asset_id"},
        cascade=cascade,
        evidence=evidence,
    )


@router.get("/api/assets/{asset_id}/explanation")
async def explain_asset(asset_id: str) -> dict[str, Any]:
    _ensure_ready()
    detail = await get_asset(asset_id)
    ctx = ExplanationContext(
        asset_id=detail.asset_id,
        asset_name=detail.asset_name,
        asset_type=detail.asset_type,
        region=detail.region,
        service_population=detail.service_population,
        risk_score=detail.risk_score,
        contributing_factors={
            k: v
            for k, v in detail.features.items()
            if k
            in {
                "criticality_rating",
                "condition_score",
                "flood_zone",
                "ground_elevation_ft",
                "min_dist_to_surge_zone_m",
                "min_dist_to_flood_zone_m",
                "recent_scada_warnings",
                "recent_high_severity_reports",
                "overdue_work_orders",
                "within_hurricane_cone",
                "has_backup_power",
            }
        },
        evidence=detail.evidence,
    )
    explanation = await generate_explanation(ctx)

    async with session_scope() as session:
        current_hash = await audit_append(
            session,
            user="system",
            action_type="explanation_generated",
            subject_id=asset_id,
            payload={"asset_id": asset_id, "risk_level": explanation.risk_level},
            prompt_version="explanation-v1",
        )

    return {
        "explanation": explanation.model_dump(),
        "audit": {"current_hash": current_hash},
    }


@router.get("/api/hazard-zones")
async def hazard_zones() -> dict[str, Any]:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT hazard_zone_id, hazard_type, severity_band, source, "
                " ST_AsGeoJSON(geom) AS geom FROM hazard_zones"
            )
        )
        features = []
        for row in result.mappings():
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "hazard_zone_id": row["hazard_zone_id"],
                        "hazard_type": row["hazard_type"],
                        "severity_band": row["severity_band"],
                        "source": row["source"],
                    },
                    "geometry": json.loads(row["geom"]),
                }
            )
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/hurricane-tracks")
async def hurricane_tracks() -> dict[str, Any]:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT storm_id, storm_name, advisory_number, issued_at, "
                " ST_AsGeoJSON(cone) AS cone, ST_AsGeoJSON(track_line) AS track "
                "FROM hurricane_tracks"
            )
        )
        features = []
        for row in result.mappings():
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "storm_id": row["storm_id"],
                        "storm_name": row["storm_name"],
                        "advisory_number": row["advisory_number"],
                        "issued_at": row["issued_at"].isoformat(),
                        "kind": "cone",
                    },
                    "geometry": json.loads(row["cone"]),
                }
            )
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "storm_id": row["storm_id"],
                        "storm_name": row["storm_name"],
                        "kind": "track",
                    },
                    "geometry": json.loads(row["track"]),
                }
            )
    return {"type": "FeatureCollection", "features": features}


@router.get("/api/alerts")
async def alerts() -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT alert_id, hazard_type, severity, urgency, "
                " issued_at, expires_at, headline "
                "FROM weather_alerts ORDER BY issued_at DESC LIMIT 100"
            )
        )
        return [
            {
                "alert_id": r["alert_id"],
                "hazard_type": r["hazard_type"],
                "severity": r["severity"],
                "urgency": r["urgency"],
                "issued_at": r["issued_at"].isoformat(),
                "expires_at": r["expires_at"].isoformat(),
                "headline": r["headline"],
            }
            for r in result.mappings()
        ]


@router.get("/api/forecasts/water-level")
async def water_level_forecast(
    source: str | None = None, horizon_hours: int = 24
) -> dict[str, Any]:
    """Return recent observations + a Prophet forecast horizon.

    ``source`` accepts the explicit source string when a caller wants a
    specific archived window (``NOS_COOPS:debby_2024`` / ``NOS_COOPS:idalia_2023``).
    Omit it or pass ``"live"`` to use the rolling live buffer written by the
    CO-OPS poller (``NOS_COOPS:live_8665530``). If the live buffer is empty
    (cold start before the first poll cycle finishes) we fall back to Debby
    so the sparkline always renders.
    """
    import pandas as pd

    from sgw_platform.models.forecast import WaterLevelForecaster
    from sgw_platform.polling import COOPS_LIVE_SOURCE

    requested = source if source and source != "live" else COOPS_LIVE_SOURCE
    resolved = requested
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT observation_time AS ds, water_level_ft AS y "
                "FROM weather_observations "
                "WHERE source = :s AND water_level_ft IS NOT NULL "
                "ORDER BY observation_time"
            ),
            {"s": requested},
        )
        history = pd.DataFrame(result.mappings().all())
        if history.empty and requested == COOPS_LIVE_SOURCE:
            # Live buffer not populated yet — fall back to the Debby fixture
            # so the sparkline always has something to render.
            resolved = "NOS_COOPS:debby_2024"
            result = await session.execute(
                text(
                    "SELECT observation_time AS ds, water_level_ft AS y "
                    "FROM weather_observations "
                    "WHERE source = :s AND water_level_ft IS NOT NULL "
                    "ORDER BY observation_time"
                ),
                {"s": resolved},
            )
            history = pd.DataFrame(result.mappings().all())
    if history.empty:
        raise HTTPException(status_code=404, detail=f"no history for source {requested}")

    forecaster = WaterLevelForecaster()
    fc = forecaster.fit_and_forecast(history, horizon_hours=horizon_hours, test_hours=0)

    # For LIVE we return a short trailing window (the rolling recent tide).
    # For archived fixtures we centre the returned window on the peak so the
    # operator actually sees the storm surge arc — otherwise the tail of the
    # fixture (post-event recovery) looks indistinguishable from calm current
    # tide, defeating the point of DEBBY replay mode.
    is_live = resolved == COOPS_LIVE_SOURCE
    if is_live:
        tail = history.tail(48)
    else:
        peak_idx = int(history["y"].idxmax())
        half = 120  # ~12h either side at 6-min cadence
        lo = max(0, peak_idx - half)
        hi = min(len(history), peak_idx + half + 1)
        tail = history.iloc[lo:hi]

    return {
        "source": resolved,
        "requested_source": requested,
        "is_live": is_live,
        "history_points": len(history),
        "history_tail": [
            {"ds": str(r["ds"]), "y": float(r["y"])}
            for _, r in tail.iterrows()
        ],
        "forecast": [
            {"ds": str(ds), "yhat": yhat, "yhat_lower": lo, "yhat_upper": hi}
            for ds, yhat, lo, hi in zip(fc.ds, fc.yhat, fc.yhat_lower, fc.yhat_upper, strict=True)
        ],
    }


@router.post("/api/decisions")
async def record_decision(decision: DecisionIn) -> dict[str, Any]:
    from sgw_platform.alignment import maybe_retrain

    async with session_scope() as session:
        await session.execute(
            text(
                "INSERT INTO operator_decisions (timestamp, prediction_id, \"user\", action, reason) "
                "VALUES (NOW(), :pid, :u, :a, :r)"
            ),
            {"pid": decision.prediction_id, "u": decision.user, "a": decision.action, "r": decision.reason},
        )
        current_hash = await audit_append(
            session,
            user=decision.user,
            action_type=f"operator_{decision.action}",
            subject_id=decision.asset_id,
            payload=decision.model_dump(),
        )
        # Preference-learning hook — every decision is a labelled sample for
        # the operator-alignment model. Auto-retrains every N decisions.
        # Failures are swallowed inside `maybe_retrain` so the decision
        # itself always commits.
        await maybe_retrain(session)
    return {"ok": True, "audit_hash": current_hash}


@router.get("/api/audit")
async def get_audit(limit: int = Query(100, le=500)) -> list[dict[str, Any]]:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT id, timestamp, \"user\", action_type, subject_id, current_hash "
                "FROM audit_log ORDER BY id DESC LIMIT :n"
            ),
            {"n": limit},
        )
        return [
            {
                "id": r["id"],
                "timestamp": r["timestamp"].isoformat(),
                "user": r["user"],
                "action_type": r["action_type"],
                "subject_id": r["subject_id"],
                "current_hash": r["current_hash"],
            }
            for r in result.mappings()
        ]


@router.get("/api/governance/fairness")
async def governance_fairness() -> dict[str, Any]:
    _ensure_ready()
    assert STATE.features is not None and STATE.scores is not None
    y_true = synthesise_labels(STATE.features, "hurricane")
    fair = fairness_audit(STATE.features, STATE.scores, y_true, group_column="region")
    return {
        "group_column": fair.group_column,
        "demographic_parity_gap": fair.demographic_parity_gap,
        "equal_opportunity_gap": fair.equal_opportunity_gap,
        "per_group": fair.per_group.to_dict(orient="records"),
    }


@router.get("/api/governance/model")
async def governance_model() -> dict[str, Any]:
    """Snapshot of current model metrics + top feature importances for the governance dashboard."""
    _ensure_ready()
    tr = STATE.training_report
    risk = tr.get("risk", {}) if isinstance(tr, dict) else {}
    return {
        "risk_model": {
            "version": risk.get("model_version"),
            "metrics": risk.get("metrics", {}),
            "top_features": risk.get("top_features", {}),
        },
        "graph": tr.get("graph", {}) if isinstance(tr, dict) else {},
    }


_REGION_LABEL = {
    "COAST_EAST": "Coastal East (SC)",
    "LOWER_DELTA": "Lower Delta (GA)",
    "INLAND_NORTH": "Inland North (NC)",
}


def _pretty_asset_type(t: str) -> str:
    return " ".join(w.capitalize() for w in t.split("_"))


def _pretty_region(r: str) -> str:
    return _REGION_LABEL.get(r, r)


@router.post("/api/briefing/generate")
async def briefing_generate() -> dict[str, Any]:
    """LLM-drafted executive briefing built from the current operational picture."""
    _ensure_ready()
    assert STATE.features is not None and STATE.scores is not None

    # Assemble the operational picture from what's in memory.
    import pandas as pd

    df = STATE.features.copy()
    df["risk_score"] = STATE.scores.values
    df["service_population"] = df["service_population"].fillna(0)
    df = df.sort_values("risk_score", ascending=False)
    top = df.head(10)
    top_risks = [
        {
            "asset_id": r["asset_id"],
            "asset_type_label": _pretty_asset_type(str(r["asset_type"])),
            "region_label": _pretty_region(str(r["region"])),
            "risk_score": float(r["risk_score"]),
            "service_population": int(r["service_population"]) if not pd.isna(r["service_population"]) else 0,
            "within_hurricane_cone": bool(r.get("within_hurricane_cone", 0)),
        }
        for _, r in top.iterrows()
    ]

    critical = int((df["risk_score"] >= 0.80).sum())
    high = int(((df["risk_score"] >= 0.60) & (df["risk_score"] < 0.80)).sum())
    at_risk_pop = int(df[df["risk_score"] >= 0.60]["service_population"].sum())
    cone_asset_count = int(df["within_hurricane_cone"].astype(bool).sum()) if "within_hurricane_cone" in df.columns else 0

    async with session_scope() as session:
        alerts_result = await session.execute(
            text(
                "SELECT hazard_type, COUNT(*) AS n FROM weather_alerts "
                "WHERE expires_at > NOW() GROUP BY hazard_type"
            )
        )
        alert_rows = list(alerts_result.mappings())

        # Real recent operator actions from the audit log — grounded, not invented.
        audit_result = await session.execute(
            text(
                "SELECT timestamp, \"user\", action_type, subject_id, payload "
                "FROM audit_log "
                "WHERE action_type IN ('operator_accept', 'operator_override', 'operator_comment') "
                "ORDER BY id DESC LIMIT 8"
            )
        )
        audit_rows = list(audit_result.mappings())

    active_alert_count = sum(r["n"] for r in alert_rows)
    hazard_types = [r["hazard_type"] for r in alert_rows if r["hazard_type"]]

    recorded_audit_actions = [
        {
            "timestamp": r["timestamp"].isoformat(),
            "user": r["user"],
            "action": r["action_type"].replace("operator_", ""),
            "subject_id": r["subject_id"],
            "reason": (r["payload"] or {}).get("reason"),
        }
        for r in audit_rows
    ]

    cone_note = (
        "These are stress-test overlays derived from the historic Hurricane Debby (Aug 2024) and "
        "Hurricane Idalia (Aug 2023) forecast cones baked into the risk model — they influence "
        "risk scores but do NOT indicate an active hurricane."
        if cone_asset_count > 0
        else ""
    )

    ctx = BriefingContext(
        active_alert_count=active_alert_count,
        critical_assets=critical,
        high_assets=high,
        total_service_population_at_risk=at_risk_pop,
        top_risks=top_risks,
        active_hazard_types=hazard_types,
        model_version=(STATE.training_report.get("risk", {}) or {}).get("model_version", "unknown"),
        recorded_audit_actions=recorded_audit_actions,
        cone_asset_count=cone_asset_count,
        cone_note=cone_note,
    )
    briefing = await generate_briefing(ctx)

    async with session_scope() as session:
        current_hash = await audit_append(
            session,
            user="system",
            action_type="briefing_generated",
            subject_id="operational_picture",
            payload={"critical": critical, "high": high, "population_at_risk": at_risk_pop},
            prompt_version="briefing-v2",
        )

    return {
        "briefing": briefing.model_dump(),
        "snapshot": {
            "critical_assets": critical,
            "high_assets": high,
            "population_at_risk": at_risk_pop,
            "active_alerts": active_alert_count,
            "hazard_types": hazard_types,
        },
        "audit": {"current_hash": current_hash},
    }


# ------------------------------ data source provenance ------------------------------


@router.get("/api/data-sources")
async def data_sources() -> dict[str, Any]:
    """Provenance manifest — every feed powering the platform, honestly labelled.

    Kinds:
      * ``live``       — actively polled from the upstream provider on a cadence
      * ``archived``   — real historic data ingested once (Debby, Idalia, etc.)
      * ``static_ref`` — infrequently-changing reference layer (SLOSH MOM, flood zones)
      * ``synthetic``  — generated to stand in for SGW's internal systems
      * ``trained``    — a model artefact produced from the above
      * ``planned``    — declared here so the popover doesn't hide the roadmap
    """
    from sgw_platform.polling import COOPS_LIVE_SOURCE, POLLERS

    async with session_scope() as session:
        weather_counts = await session.execute(
            text("SELECT source, COUNT(*) AS n FROM weather_observations GROUP BY source")
        )
        weather_rows = {r["source"]: r["n"] for r in weather_counts.mappings()}
        alert_active = (
            await session.execute(text("SELECT COUNT(*) FROM weather_alerts WHERE expires_at > NOW()"))
        ).scalar_one()
        tracks = (await session.execute(text("SELECT COUNT(*) FROM hurricane_tracks"))).scalar_one()
        assets_n = (await session.execute(text("SELECT COUNT(*) FROM assets"))).scalar_one()
        scada_n = (await session.execute(text("SELECT COUNT(*) FROM sensor_readings"))).scalar_one()
    tr = STATE.training_report or {}
    coops_live_rows = weather_rows.get(COOPS_LIVE_SOURCE, 0)

    nws_poller = POLLERS.nws_alerts.as_dict()
    coops_poller = POLLERS.coops_water.as_dict()

    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "sources": [
            {
                "id": "nws_alerts",
                "label": "NWS active alerts",
                "kind": "live",
                "provider": "api.weather.gov",
                "cadence": f"polled every {nws_poller['cadence_seconds']}s (SC / GA / NC)",
                "freshness": nws_poller,
                "detail": (
                    f"{alert_active} active alerts. "
                    "Adapter: sgw_platform.adapters.nws.NwsAlertAdapter. "
                    "Poller upserts by alert_id and sweeps rows expired > 24h ago."
                ),
            },
            {
                "id": "coops_live",
                "label": "Charleston Harbor water levels · live",
                "kind": "live",
                "provider": "NOS CO-OPS gauge 8665530",
                "cadence": (
                    f"polled every {coops_poller['cadence_seconds']}s "
                    f"(matches upstream 6-minute cadence)"
                ),
                "freshness": coops_poller,
                "detail": (
                    f"{coops_live_rows} rows in the rolling 48h buffer. "
                    "Prophet re-fits per /api/forecasts/water-level call. "
                    "Anomaly detection = residuals outside the 80% band."
                ),
            },
            {
                "id": "coops_archived",
                "label": "Charleston Harbor water levels · event archives",
                "kind": "archived",
                "provider": "NOS CO-OPS gauge 8665530",
                "detail": (
                    "Debby (Aug 2024): "
                    f"{weather_rows.get('NOS_COOPS:debby_2024', 0)} rows · "
                    "Idalia (Aug 2023): "
                    f"{weather_rows.get('NOS_COOPS:idalia_2023', 0)} rows. "
                    "Retained as the risk-model stress-test window and as fallback when the "
                    "live buffer is empty (cold-start seconds after boot)."
                ),
            },
            {
                "id": "hurricane_tracks",
                "label": "Hurricane tracks",
                "kind": "archived",
                "provider": "Prototype fixtures derived from public NHC advisories",
                "detail": (
                    f"{tracks} historic storm tracks — Debby 2024 + Idalia 2023. "
                    "Real NHC forecast-cone shapefiles per advisory = planned upgrade "
                    "(sgw_platform.adapters.nhc is scaffolded)."
                ),
            },
            {
                "id": "hazard_zones",
                "label": "Hazard zone polygons",
                "kind": "synthetic",
                "provider": "Placeholder polygons",
                "detail": (
                    "Randomly-generated polygons approximating flood / surge / wildfire / heat zones. "
                    "Real Digital Coast + NHC SLOSH MOM clips = Phase 2 upgrade (see planned source below)."
                ),
            },
            {
                "id": "assets",
                "label": "SGW asset registry",
                "kind": "synthetic",
                "provider": "scripts.generate_mock_data (seed=42)",
                "detail": f"{assets_n} assets across coastal SC / GA + inland NC.",
            },
            {
                "id": "scada",
                "label": "SCADA telemetry",
                "kind": "synthetic",
                "provider": "scripts.generate_mock_data + injected anomalies",
                "detail": f"{scada_n:,} readings across ~70 instrumented assets over one week.",
            },
            {
                "id": "risk_model",
                "label": "Risk-scoring model",
                "kind": "trained",
                "provider": "LightGBM classifier + isotonic calibration · RF baseline",
                "detail": (
                    f"Version {(tr.get('risk', {}) or {}).get('model_version', 'unknown')}. "
                    "Metrics live on the Governance tab. Labels synthesised — no real historical "
                    "incidents for a fictional utility."
                ),
            },
            {
                "id": "llm",
                "label": "AI copilot LLM",
                "kind": "live",
                "provider": "Ollama Cloud · gpt-oss:120b",
                "detail": (
                    "Structured outputs via schema-in-prompt-AND-format. "
                    "Never produces risk scores / forecasts — narrates + cites only."
                ),
            },
            # --- Broader NOAA feeds — declared as planned so the roadmap is visible.
            {
                "id": "nhc_gis",
                "label": "NHC forecast cone + SLOSH MOM",
                "kind": "planned",
                "provider": "nhc.noaa.gov/gis · Shapefile / KMZ / WMS per advisory",
                "detail": (
                    "Replaces the hand-curated cones/tracks with the real per-advisory shapefiles. "
                    "Phase 2 · sgw_platform.adapters.nhc scaffolded."
                ),
            },
            {
                "id": "digital_coast",
                "label": "Digital Coast — coastal flood exposure",
                "kind": "planned",
                "provider": "coast.noaa.gov · Shapefile / GeoTIFF + ArcGIS REST",
                "detail": (
                    "Seeds hazard_zones with real coastal exposure polygons for the SC/GA/NC footprint "
                    "(replaces the synthetic placeholders)."
                ),
            },
            {
                "id": "nowcoast",
                "label": "nowCOAST aggregator",
                "kind": "planned",
                "provider": "nowcoast.noaa.gov · WMS / WFS / ArcGIS REST",
                "detail": (
                    "Backup / cross-check layer for the map — warnings polygons, precip, coastal flood, SST."
                ),
            },
            {
                "id": "spc_cpc",
                "label": "SPC severe-storm + CPC heat/drought outlooks",
                "kind": "planned",
                "provider": "spc.noaa.gov · cpc.ncep.noaa.gov (Shapefile / KMZ, daily)",
                "detail": (
                    "Hazard-gradient polygons for heatwave and severe-storm scenarios — bridges the gap "
                    "where NWS alerts only fire on event, not on risk."
                ),
            },
            {
                "id": "nwm",
                "label": "National Water Model streamflow",
                "kind": "planned",
                "provider": "s3://noaa-nwm-pds (anonymous S3, NetCDF)",
                "detail": (
                    "2.7km continental streamflow forecasts — the inland-flood risk story. "
                    "Phase 2 hook, strongest for the water side of SGW."
                ),
            },
            {
                "id": "hrrr",
                "label": "NCEP HRRR gridded forecast",
                "kind": "planned",
                "provider": "s3://noaa-hrrr-bdp-pds (GRIB2, 3km hourly)",
                "detail": (
                    "Higher-fidelity forecast features than NWS /gridpoints — Phase 2 upgrade if the "
                    "risk model wants raw meteorological features."
                ),
            },
            {
                "id": "ncei_events",
                "label": "NCEI Storm Events historical training set",
                "kind": "static_ref",
                "provider": "ncei.noaa.gov · CSV bulk download",
                "detail": (
                    "Historic events with geospatial + damage fields (1950 to present). "
                    "Training data for the hazard-conditional risk-scoring model — imported once, versioned."
                ),
            },
            {
                "id": "ngs_imagery",
                "label": "NGS Emergency Response aerial imagery",
                "kind": "planned",
                "provider": "geodesy.noaa.gov · GeoTIFF / tile services (post-event)",
                "detail": (
                    "Post-storm damage-assessment imagery — the Alt-3 workflow deferred to Phase 3."
                ),
            },
        ],
    }


# ------------------------------ agent chat (streaming) ------------------------------


class AgentMessage(BaseModel):
    role: str
    content: str


class AgentChatRequest(BaseModel):
    messages: list[AgentMessage]
    asset_id: str | None = None


@router.post("/api/agent/chat/stream")
async def agent_chat_stream(req: AgentChatRequest):
    """SSE stream of agent tokens + tool calls + final message."""
    _ensure_ready()
    asset_context: dict[str, Any] | None = None
    if req.asset_id and STATE.features is not None:
        matches = STATE.features["asset_id"] == req.asset_id
        if matches.any():
            idx = STATE.features.index[matches][0]
            asset_context = {
                "asset_id": req.asset_id,
                "region": str(STATE.features.loc[idx, "region"]),
                "asset_type": str(STATE.features.loc[idx, "asset_type"]),
            }

    async def _sse() -> Any:
        try:
            async for event in stream_agent(
                messages=[m.model_dump() for m in req.messages],
                asset_context=asset_context,
            ):
                yield f"data: {json.dumps(event, default=str)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(exc)[:400]}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ------------------------------ scenario agent ------------------------------


@router.get("/api/scenarios/presets")
async def scenarios_presets() -> dict[str, Any]:
    """Return the three MVP preset ScenarioSpecs so the frontend can render
    stable preset chips without needing to hardcode the same values on both sides."""
    return {
        "presets": {
            key: spec.model_dump(mode="json")
            for key, spec in PRESET_SPECS.items()
        }
    }


@router.post("/api/scenarios/run", response_model=ScenarioReport)
async def scenarios_run(req: ScenarioRequest) -> ScenarioReport:
    """Run a scenario against the live asset state.

    Two input modes:
      · preset  — one of the three MVP shortcut keys; LLM parser is skipped.
      · directive — natural-language directive; parsed via the LLM into a ScenarioSpec.

    Every run writes a `scenario_generated` entry to the audit log with the
    fully-serialised ScenarioSpec so re-runs are traceable.
    """
    _ensure_ready()

    # Resolve the spec — preset short-circuit or LLM parse.
    if req.preset:
        if req.preset not in PRESET_SPECS:
            raise HTTPException(status_code=400, detail=f"unknown preset '{req.preset}'")
        spec: ScenarioSpec = PRESET_SPECS[req.preset]
    elif req.directive:
        spec = await parse_directive(req.directive)
    else:
        raise HTTPException(status_code=400, detail="either 'preset' or 'directive' is required")

    # STATE.features has no asset_name column — load an id → name map from the DB
    # once per scenario run and pass it into the ranker.
    async with session_scope() as session:
        result = await session.execute(text("SELECT asset_id, asset_name FROM assets"))
        asset_names: dict[str, str] = {row[0]: row[1] for row in result}

    # Run the risk model against the scenario-conditioned features.
    try:
        impacts, total_impacted = run_scenario(spec, asset_names)
    except Exception as exc:  # noqa: BLE001 — surface as 500 with detail
        log.error("scenarios.run.failed", error=str(exc), spec=spec.model_dump(mode="json"))
        raise HTTPException(status_code=500, detail=f"scenario runner failed: {exc}") from exc

    # Draft the LLM narration + recommendation.
    narration = await generate_scenario_narration(spec, impacts)

    scenario_id = f"SCN-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S')}"
    async with session_scope() as session:
        current_hash = await audit_append(
            session,
            user=req.user,
            action_type="scenario_generated",
            subject_id=scenario_id,
            payload={
                "spec": spec.model_dump(mode="json"),
                "top_impact_ids": [i.asset_id for i in impacts[:5]],
                "total_impacted": total_impacted,
            },
            prompt_version="scenario-v1",
        )

    return ScenarioReport(
        scenario_id=scenario_id,
        spec=spec,
        generated_at=datetime.now(UTC),
        ranked_impacts=impacts,
        total_assets_impacted=total_impacted,
        summary=narration.summary,
        recommendation=narration.recommendation,
        evidence=narration.evidence,
        audit_hash=current_hash,
    )


class ScenarioDecisionIn(BaseModel):
    action: str  # accept | override | comment
    reason: str | None = None
    user: str = "operator"


@router.post("/api/scenarios/{scenario_id}/decision")
async def scenarios_decide(scenario_id: str, decision: ScenarioDecisionIn) -> dict[str, Any]:
    """Record the operator's HITL response to a scenario recommendation.

    Writes to the append-only audit log alongside every other operator action;
    Accept for a scenario is understood as "add the recommended preventative
    work orders to the queue" — the queue itself is a Phase 2 endpoint, so for
    the demo the audit-log entry IS the receipt."""
    async with session_scope() as session:
        current_hash = await audit_append(
            session,
            user=decision.user,
            action_type=f"scenario_{decision.action}",
            subject_id=scenario_id,
            payload=decision.model_dump(),
        )
    return {"ok": True, "audit_hash": current_hash}


# ---------- operator-alignment (preference-learning / RLHF-lite) -------------


@router.get("/api/alignment")
async def alignment_state() -> dict[str, Any]:
    """Return the current alignment-model state — fitted-ness, feature
    weights, retrain history. Consumed by the Governance page and the
    cockpit header chip."""
    from sgw_platform.alignment import ALIGNMENT_STATE

    return ALIGNMENT_STATE.to_dict()


@router.post("/api/alignment/retrain")
async def alignment_retrain() -> dict[str, Any]:
    """Force a retrain of the alignment model against every operator_*
    decision in audit_log. Returns the updated state."""
    from sgw_platform.alignment import retrain_now

    async with session_scope() as session:
        return await retrain_now(session)


@router.get("/api/alignment/adjustments")
async def alignment_adjustments(asset_ids: str = Query(..., min_length=1)) -> dict[str, Any]:
    """Batch endpoint — returns the per-asset alignment nudge for a list of
    comma-separated asset_ids. Zero-adjustment fallback when the model
    isn't fitted OR an asset isn't in STATE.features."""
    from sgw_platform.alignment import predict_adjustments

    ids = [a.strip() for a in asset_ids.split(",") if a.strip()]
    preds = predict_adjustments(ids)
    return {
        "adjustments": [
            {"asset_id": p.asset_id, "p_defer": p.p_defer, "adjustment": p.adjustment}
            for p in preds
        ]
    }
