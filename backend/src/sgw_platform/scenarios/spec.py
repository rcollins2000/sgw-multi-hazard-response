"""Typed contracts for the scenario agent — Pydantic all the way through.

Every scenario run produces a ScenarioReport which is:
    · serialisable to the frontend
    · loggable to the audit trail
    · comparable across runs (e.g. two Cat 3 landfalls at Charleston should
      produce similar impact rankings)

Keeping the shapes strict prevents the LLM from silently producing a
half-formed scenario the risk model can't run on.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---- input ------------------------------------------------------------------

ScenarioKind = Literal["replay", "synthesised", "worst_case_cascade"]
"""What kind of scenario the runner should execute."""


class ScenarioSpec(BaseModel):
    """Structured directive produced by the LLM parser (or by a preset short-circuit).

    The LLM sees `ScenarioSpec.model_json_schema()` and returns a JSON matching
    this shape. All optional fields let the LLM omit anything the operator
    didn't specify — the runner has sensible defaults.
    """

    model_config = ConfigDict(extra="forbid")

    kind: ScenarioKind = Field(
        description="Which scenario runner to invoke. 'replay' loads a historic event's overlays "
        "against today's asset state. 'synthesised' builds hazard layers from severity + region. "
        "'worst_case_cascade' skips hazard perturbation and ranks assets by "
        "preventative_priority × cascade depth.",
    )
    label: str = Field(
        description="Short human-readable label the UI shows next to the scenario, "
        "e.g. 'Replay Idalia (2023) against today's assets'.",
        max_length=200,
    )
    hazard_type: str | None = Field(
        default=None,
        description="hurricane | flood | heatwave | wildfire | none",
        max_length=32,
    )
    severity: str | None = Field(
        default=None,
        description="cat_1 | cat_2 | cat_3 | cat_4 | cat_5 | moderate | severe | extreme",
        max_length=32,
    )
    region_focus: str | None = Field(
        default=None,
        description="COAST_EAST | LOWER_DELTA | INLAND_NORTH — restrict feature perturbations to assets in this region.",
        max_length=32,
    )
    horizon_days: int | None = Field(
        default=None,
        description="How far into the future the scenario is projected. 0 means 'right now'. Purely narrative — the risk model does not condition on horizon.",
        ge=0,
        le=365,
    )
    reference_event: str | None = Field(
        default=None,
        description="Fixture key used by kind='replay'. Supported values: hurricane_idalia_2023, hurricane_debby_2024.",
        max_length=64,
    )
    surge_lift_pct: float | None = Field(
        default=None,
        description="Fractional reduction in min_dist_to_surge_zone_m applied to affected assets (0.0-1.0). 0.5 halves the distance, 1.0 zeroes it.",
        ge=0.0,
        le=1.0,
    )
    within_cone_ratio: float | None = Field(
        default=None,
        description="Fraction of assets in the target region (0.0-1.0) marked as within_hurricane_cone.",
        ge=0.0,
        le=1.0,
    )
    notes: str | None = Field(
        default=None,
        description="Free-text caveats or LLM-authored assumptions.",
        max_length=1000,
    )
    path_template_hint: (
        Literal[
            "hurricane_idalia_2023",
            "hurricane_debby_2024",
            "hurricane_matthew_2016",
            "hurricane_michael_2018",
            "cat3_charleston_30d",
        ]
        | None
    ) = Field(
        default=None,
        description=(
            "Optional map-path template the frontend should render for this scenario. "
            "The LLM picks the closest match from the library when the directive describes "
            "a hypothetical storm trajectory (e.g. 'from Caribbean into SE coast' → matthew_2016). "
            "Leave null when no directional cue is provided; the frontend falls back to "
            "region-based selection."
        ),
    )


# ---- output -----------------------------------------------------------------


class ScenarioImpact(BaseModel):
    """One asset's ranked impact under a scenario."""

    model_config = ConfigDict(extra="forbid")

    asset_id: str
    asset_name: str
    region: str
    utility_domain: str

    baseline_score: float
    """Risk score against the current live feature state (what /api/assets serves today)."""
    scenario_score: float
    """Risk score against the scenario-conditioned features. Same model, mutated inputs."""
    delta: float
    """scenario_score − baseline_score. Positive = scenario makes this asset worse."""

    consequence: float
    """Preventative-priority consequence component (criticality × population × cluster size)."""
    ranked_priority: float
    """Combined ranking signal used to order the list."""
    cascade_depth: int
    """Number of downstream assets reachable via the dependency graph."""
    cluster: int | None
    """Louvain blast-radius cluster."""


class ScenarioReport(BaseModel):
    """The full response payload — one per scenario run.

    Serialised to the frontend for rendering AND to the audit log for traceability.
    """

    model_config = ConfigDict(extra="forbid")

    scenario_id: str
    spec: ScenarioSpec
    generated_at: datetime

    ranked_impacts: list[ScenarioImpact]
    total_assets_impacted: int
    """Count of assets whose scenario_score − baseline_score > 0.05 (an operator-tunable threshold)."""

    summary: str
    """One-paragraph LLM narrative summarising what the scenario would look like."""
    recommendation: str
    """One-sentence imperative recommendation the operator can act on."""
    evidence: list[str]
    """Cited source-record IDs (asset IDs, work-order IDs, sensor IDs)."""

    audit_hash: str
    """Hash of the audit-log entry written for this scenario run."""


class ScenarioRequest(BaseModel):
    """API-level input — the operator's directive."""

    model_config = ConfigDict(extra="forbid")

    directive: str | None = Field(
        default=None,
        description="Natural-language directive. Ignored when preset is provided.",
        max_length=1000,
    )
    preset: (
        Literal[
            "replay_idalia",
            "replay_debby",
            "cat3_charleston_30d",
            "worst_case_cascade",
        ]
        | None
    ) = Field(
        default=None,
        description="One of the MVP preset shortcuts. When set, the LLM parser is skipped "
        "and the corresponding hardcoded ScenarioSpec is used.",
    )
    user: str = Field(default="operator", description="Actor recorded in the audit log.")
