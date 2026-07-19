"""Fit all AI models against the current DB state and persist a training report.

Not a training-optimised runner — the goal is a demo-quality artefact and a
sanity-check that every capability produces plausible output on real fixtures.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

import pandas as pd
import typer
from sqlalchemy import select, text

from sgw_platform.db.models import AssetDependency
from sgw_platform.db.session import session_scope
from sgw_platform.features.builder import build_features
from sgw_platform.governance.fairness import audit as fairness_audit
from sgw_platform.graph.blast_radius import compute_blast_radius
from sgw_platform.graph.dependency import DependencyGraph
from sgw_platform.models.anomaly import detect_anomalies_from_prophet_fit
from sgw_platform.models.forecast import WaterLevelForecaster
from sgw_platform.models.risk import RiskScoringModel, synthesise_labels
from sgw_platform.observability.logging import configure_logging, get_logger

configure_logging()
log = get_logger("train_all")

app = typer.Typer(add_completion=False)


async def _load_water_history() -> pd.DataFrame:
    """Load Charleston Debby water levels as the demo time-series."""
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT observation_time AS ds, water_level_ft AS y "
                "FROM weather_observations "
                "WHERE source = 'NOS_COOPS:debby_2024' "
                "  AND water_level_ft IS NOT NULL "
                "ORDER BY observation_time"
            )
        )
        rows = result.mappings().all()
    return pd.DataFrame(rows)


async def _load_dependency_graph() -> DependencyGraph:
    dg = DependencyGraph()
    async with session_scope() as session:
        await dg.load(session)
    return dg


async def _load_features() -> pd.DataFrame:
    async with session_scope() as session:
        return await build_features(session)


@app.command()
def main(
    report_out: Path = typer.Option(
        Path(__file__).resolve().parents[4] / "data" / "curated" / "training_report.json",
        help="Where to write the training report JSON",
    ),
) -> None:
    async def _run() -> dict[str, object]:
        report: dict[str, object] = {"trained_at": datetime.now(UTC).isoformat()}

        # 1. Risk scoring
        log.info("train.risk.begin")
        features = await _load_features()
        risk = RiskScoringModel(hazard_type="hurricane")
        risk_report = risk.fit(features)
        report["risk_model"] = {
            "model_family": risk_report.model_family,
            "model_version": risk_report.model_version,
            "label_source": risk_report.label_source,
            "metrics": risk_report.metrics,
            "top_features": dict(
                sorted(risk_report.feature_importance.items(), key=lambda kv: kv[1], reverse=True)[:8]
            ),
        }
        log.info("train.risk.done", **risk_report.metrics)

        # 2. Fairness audit
        log.info("train.fairness.begin")
        y_score = risk.predict_proba(features)
        y_true = synthesise_labels(features, hazard_type="hurricane")
        fair = fairness_audit(features, y_score, y_true, group_column="region")
        report["fairness"] = {
            "group_column": fair.group_column,
            "demographic_parity_gap": fair.demographic_parity_gap,
            "equal_opportunity_gap": fair.equal_opportunity_gap,
            "per_group": fair.per_group.to_dict(orient="records"),
        }
        log.info(
            "train.fairness.done",
            dp_gap=fair.demographic_parity_gap,
            eo_gap=fair.equal_opportunity_gap,
        )

        # 3. Forecasting (Prophet on Charleston water levels)
        log.info("train.forecast.begin")
        history = await _load_water_history()
        forecaster = WaterLevelForecaster()
        fc = forecaster.fit_and_forecast(history, horizon_hours=24, test_hours=24)
        report["forecast"] = {
            "target": "coops_8665530_debby_water_level_ft",
            "train_size": fc.train_size,
            "test_size": fc.test_size,
            "mape": fc.mape,
            "coverage_80": fc.coverage_80,
            "next_24h": [
                {"ds": str(ds), "yhat": yhat, "yhat_lower": lo, "yhat_upper": hi}
                for ds, yhat, lo, hi in zip(fc.ds, fc.yhat, fc.yhat_lower, fc.yhat_upper, strict=True)
            ][:6],
        }
        log.info("train.forecast.done", mape=fc.mape, coverage_80=fc.coverage_80)

        # 4. Anomaly detection (Prophet-residual over the same history)
        log.info("train.anomaly.begin")
        assert forecaster.model is not None
        anomaly = detect_anomalies_from_prophet_fit(history, forecaster.model, band_multiplier=1.0)
        report["anomaly"] = {
            "n_points": len(anomaly.ds),
            "n_anomalies": int(sum(anomaly.is_anomaly)),
            "max_score": float(max(anomaly.anomaly_score)) if anomaly.anomaly_score else 0.0,
            "example_flags": [
                {"ds": str(ds), "y": y, "yhat": yhat, "score": s}
                for ds, y, yhat, s, flag in zip(
                    anomaly.ds, anomaly.y, anomaly.yhat, anomaly.anomaly_score, anomaly.is_anomaly, strict=True
                )
                if flag
            ][:5],
        }
        log.info("train.anomaly.done", n_anomalies=report["anomaly"]["n_anomalies"])

        # 5. Dependency graph + blast-radius (Louvain)
        log.info("train.graph.begin")
        dg = await _load_dependency_graph()
        blast = compute_blast_radius(dg.graph)
        report["graph"] = {
            "n_nodes": dg.graph.number_of_nodes(),
            "n_edges": dg.graph.number_of_edges(),
            "n_clusters": blast.n_clusters,
            "modularity": blast.modularity,
        }
        log.info("train.graph.done", modularity=blast.modularity, n_clusters=blast.n_clusters)

        return report

    report = asyncio.run(_run())

    report_out.parent.mkdir(parents=True, exist_ok=True)
    report_out.write_text(json.dumps(report, indent=2, default=str))
    log.info("train_all.done", report_path=str(report_out))


if __name__ == "__main__":
    app()
