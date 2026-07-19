"""Scenario runner — apply a ScenarioSpec to the live feature state.

For the MVP the runner does not train a new model per scenario. Instead it:

    1. Copies the live features DataFrame from RuntimeState.
    2. Mutates a small set of columns based on the ScenarioSpec.
    3. Calls `STATE.risk_model.predict_proba(...)` on the mutated frame.
    4. Compares scenario-conditioned scores to the baseline scores.
    5. Ranks the top-N assets by scenario impact × consequence × cascade depth.

That gives the demo a defensible answer to "what would happen under this
scenario" without paying the cost of proper counterfactual inference. The
production upgrade path is documented in docs/11_scenario_agent.md.
"""

from __future__ import annotations

import math

import pandas as pd

from sgw_platform.api.state import STATE
from sgw_platform.observability.logging import get_logger
from sgw_platform.scenarios.spec import ScenarioImpact, ScenarioSpec

log = get_logger("scenarios.runner")


# ---- consequence + preventative priority ------------------------------------
# Mirror of the frontend priority helper (lib/priority.ts) so the backend +
# frontend agree on what "consequence" means. Keeps the audit log honest.

_WEIGHT_PROB = 0.55
_WEIGHT_CONSEQUENCE = 0.45
_POP_REFERENCE = 100_000
_CLUSTER_SIZE_REFERENCE = 12


def _consequence(
    row: pd.Series,
    cluster_id: int | None,
    cluster_sizes: dict[int, int],
) -> float:
    criticality = _clamp01(((row.get("criticality_rating", 3.0) or 3.0) - 1) / 4)
    pop_raw = row.get("service_population")
    population = (
        _clamp01(math.log10(1 + pop_raw) / math.log10(1 + _POP_REFERENCE))
        if pop_raw and pop_raw > 0
        else 0.1
    )
    cluster_score = (
        _clamp01((cluster_sizes.get(cluster_id, 1)) / _CLUSTER_SIZE_REFERENCE)
        if cluster_id is not None
        else 0.15
    )
    return _clamp01(0.45 * criticality + 0.35 * population + 0.2 * cluster_score)


def _priority(prob: float, consequence: float) -> float:
    return _clamp01(_WEIGHT_PROB * prob + _WEIGHT_CONSEQUENCE * consequence)


def _clamp01(v: float) -> float:
    if not math.isfinite(v):
        return 0.0
    return max(0.0, min(1.0, v))


# ---- feature mutation -------------------------------------------------------


def _apply_hazard_perturbation(
    features: pd.DataFrame,
    spec: ScenarioSpec,
) -> pd.DataFrame:
    """Return a mutated features frame reflecting the scenario's hazard overlay.

    For a hurricane / flood scenario:
      · Marks assets in `region_focus` (or all coastal assets) as within the hurricane cone,
        proportional to `within_cone_ratio`.
      · Reduces `min_dist_to_surge_zone_m` for affected assets by `surge_lift_pct`.
      · Reduces `min_dist_to_flood_zone_m` by half of `surge_lift_pct` (softer coupling).
      · Bumps `within_active_alert_area` for affected assets to 1.

    The mutation is deterministic given the same input frame + spec — important
    for the audit story.
    """
    f = features.copy()
    if spec.kind == "worst_case_cascade":
        # No hazard perturbation — the runner ranks by consequence + cascade only.
        return f

    region = spec.region_focus or "COAST_EAST"
    surge_lift = spec.surge_lift_pct if spec.surge_lift_pct is not None else 0.5
    cone_ratio = spec.within_cone_ratio if spec.within_cone_ratio is not None else 0.6

    # Deterministic subset selection: sort by risk_score desc within the region
    # and pick the top `cone_ratio` fraction.
    region_mask = f["region"] == region
    region_frame = f.loc[region_mask].copy()
    if region_frame.empty:
        log.warning("scenarios.runner.empty_region", region=region)
        return f

    scores = STATE.scores if STATE.scores is not None else pd.Series(0.5, index=f.index)
    region_frame["_score_key"] = scores.reindex(region_frame.index).fillna(0.5)
    region_frame = region_frame.sort_values("_score_key", ascending=False)
    n_affected = max(1, int(len(region_frame) * cone_ratio))
    affected_index = region_frame.iloc[:n_affected].index

    if "within_hurricane_cone" in f.columns:
        f.loc[affected_index, "within_hurricane_cone"] = 1
    if "within_active_alert_area" in f.columns:
        f.loc[affected_index, "within_active_alert_area"] = 1
    if "min_dist_to_surge_zone_m" in f.columns:
        f.loc[affected_index, "min_dist_to_surge_zone_m"] = (
            f.loc[affected_index, "min_dist_to_surge_zone_m"].fillna(5000) * (1 - surge_lift)
        )
    if "min_dist_to_flood_zone_m" in f.columns:
        f.loc[affected_index, "min_dist_to_flood_zone_m"] = (
            f.loc[affected_index, "min_dist_to_flood_zone_m"].fillna(5000) * (1 - surge_lift / 2)
        )
    return f


# ---- ranking ----------------------------------------------------------------


def _cascade_depth_of(asset_id: str) -> int:
    if STATE.dep_graph is None:
        return 0
    try:
        result = STATE.dep_graph.cascade_from(asset_id, max_depth=4)
        return len({t for _, t, _ in result.edges})
    except Exception:  # noqa: BLE001 — missing asset → depth 0
        return 0


def _cluster_of(asset_id: str) -> int | None:
    if STATE.blast_radius is None:
        return None
    return STATE.blast_radius.cluster_assignment.get(asset_id)


def _cluster_sizes() -> dict[int, int]:
    if STATE.blast_radius is None:
        return {}
    sizes: dict[int, int] = {}
    for cid in STATE.blast_radius.cluster_assignment.values():
        sizes[cid] = sizes.get(cid, 0) + 1
    return sizes


def rank_impacts(
    baseline: pd.Series,
    scenario: pd.Series,
    features: pd.DataFrame,
    asset_names: dict[str, str],
    spec: ScenarioSpec,
    top_n: int = 10,
) -> tuple[list[ScenarioImpact], int]:
    """Combine baseline + scenario scores + consequence + cascade depth into a ranked list.

    ``asset_names`` maps ``asset_id -> asset_name`` (features has neither).
    """
    sizes = _cluster_sizes()
    rows: list[ScenarioImpact] = []
    for idx in features.index:
        asset_id = str(features.at[idx, "asset_id"])
        base = float(baseline.get(idx, 0.0))
        scen = float(scenario.get(idx, base))
        cluster = _cluster_of(asset_id)
        consequence = _consequence(features.loc[idx], cluster, sizes)
        depth = _cascade_depth_of(asset_id)

        # Ranking signal — weighted so the three scenario kinds produce
        # meaningfully different orderings:
        #   · replay/synthesised → delta dominates
        #   · worst_case_cascade → depth + consequence dominate
        if spec.kind == "worst_case_cascade":
            ranked_priority = _clamp01(
                0.4 * _priority(base, consequence)
                + 0.4 * consequence
                + 0.2 * _clamp01(depth / 6)
            )
        else:
            delta = max(0.0, scen - base)
            ranked_priority = _clamp01(
                0.5 * scen + 0.3 * delta + 0.15 * consequence + 0.05 * _clamp01(depth / 8)
            )

        rows.append(
            ScenarioImpact(
                asset_id=asset_id,
                asset_name=asset_names.get(asset_id, asset_id),
                region=str(features.at[idx, "region"]),
                utility_domain=str(features.at[idx, "utility_domain"]),
                baseline_score=base,
                scenario_score=scen,
                delta=scen - base,
                consequence=consequence,
                ranked_priority=ranked_priority,
                cascade_depth=depth,
                cluster=cluster,
            )
        )

    rows.sort(key=lambda r: r.ranked_priority, reverse=True)
    total_impacted = sum(1 for r in rows if r.delta > 0.05)
    return rows[:top_n], total_impacted


# ---- top-level entry point --------------------------------------------------


def run(
    spec: ScenarioSpec, asset_names: dict[str, str]
) -> tuple[list[ScenarioImpact], int]:
    """Execute a ScenarioSpec against the live RuntimeState.

    Returns (ranked_impacts, total_assets_impacted). Callers must have already
    ensured STATE.ready — the API endpoint guards this. ``asset_names`` is
    loaded from the DB by the endpoint (``features`` does not carry it).
    """
    assert STATE.features is not None, "STATE.features not ready"
    assert STATE.scores is not None, "STATE.scores not ready"
    assert STATE.risk_model is not None, "STATE.risk_model not ready"

    baseline = STATE.scores
    mutated = _apply_hazard_perturbation(STATE.features, spec)
    scenario_scores = STATE.risk_model.predict_proba(mutated)

    return rank_impacts(baseline, scenario_scores, STATE.features, asset_names, spec)
