"""Process-wide singletons — trained models + dependency graph loaded on startup."""

from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from sgw_platform.graph.blast_radius import BlastRadiusResult, compute_blast_radius
from sgw_platform.graph.dependency import DependencyGraph
from sgw_platform.models.risk import RiskScoringModel


@dataclass
class RuntimeState:
    features: pd.DataFrame | None = None
    risk_model: RiskScoringModel | None = None
    scores: pd.Series | None = None
    dep_graph: DependencyGraph | None = None
    blast_radius: BlastRadiusResult | None = None
    ready: bool = False
    error: str | None = None
    training_report: dict = field(default_factory=dict)


STATE = RuntimeState()


async def train_or_load(session_scope_ctx) -> None:
    """Called from lifespan — trains models against the current DB state."""
    from sqlalchemy import text

    from sgw_platform.features.builder import build_features
    from sgw_platform.observability.logging import get_logger

    log = get_logger("state")
    try:
        async with session_scope_ctx() as session:
            features = await build_features(session)
        model = RiskScoringModel(hazard_type="hurricane")
        report = model.fit(features)
        scores = model.predict_proba(features)

        dg = DependencyGraph()
        async with session_scope_ctx() as session:
            await dg.load(session)
        blast = compute_blast_radius(dg.graph)

        STATE.features = features
        STATE.risk_model = model
        STATE.scores = scores
        STATE.dep_graph = dg
        STATE.blast_radius = blast
        STATE.training_report = {
            "risk": {
                "model_version": report.model_version,
                "metrics": report.metrics,
                "top_features": dict(
                    sorted(report.feature_importance.items(), key=lambda kv: kv[1], reverse=True)[:8]
                ),
            },
            "graph": {
                "n_nodes": dg.graph.number_of_nodes(),
                "n_edges": dg.graph.number_of_edges(),
                "n_clusters": blast.n_clusters,
                "modularity": blast.modularity,
            },
        }
        STATE.ready = True
        log.info("state.ready", **STATE.training_report["risk"]["metrics"])
    except Exception as exc:  # noqa: BLE001
        STATE.ready = False
        STATE.error = str(exc)
        log.error("state.failed", error=str(exc))
