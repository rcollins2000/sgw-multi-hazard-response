"""Pydantic schemas for LLM structured outputs.

Every schema mirrors the data-model §9 spec. Field descriptions matter — the
LLM reads them to decide what to populate.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AssetExplanation(BaseModel):
    """Per-asset structured explanation the LLM emits."""

    asset_id: str = Field(..., description="The canonical SGW asset ID this explanation is for.")
    risk_level: Literal["low", "moderate", "high", "critical"] = Field(
        ..., description="Overall risk classification based on the score and contributing factors."
    )
    recommended_action: str = Field(
        ..., description="A single-sentence recommended action the operator should consider."
    )
    reasoning_summary: list[str] = Field(
        ..., description="Bullet-list of the key factors driving this recommendation. Each item < 25 words."
    )
    uncertainties: list[str] = Field(
        default_factory=list,
        description="Bullet-list of caveats, data-quality concerns, or open questions.",
    )
    evidence: list[str] = Field(
        ...,
        description="List of source evidence IDs cited (weather alert IDs, work-order IDs, sensor IDs, field-report IDs). Only IDs present in the provided evidence context.",
    )
    human_approval_required: bool = Field(
        default=True,
        description="Whether operator sign-off is required before acting. Always true for MVP.",
    )


class ExecutiveBriefing(BaseModel):
    """Executive-facing briefing paragraph for the coordinator to send upstream.

    Deliberately splits recorded (factual, audit-log-derived) actions from
    recommended (LLM-suggested) actions so a stakeholder can't mistake the
    LLM's proposals for things SGW is actually doing.
    """

    headline: str = Field(..., description="One-line headline.")
    situation_summary: str = Field(
        ...,
        description=(
            "2-3 sentence situation description. If any assets fall within a historic "
            "hurricane cone footprint, describe that as a stress-test overlay influencing "
            "risk scores — do not claim an active hurricane unless the alert list shows one."
        ),
    )
    top_risks: list[str] = Field(
        ...,
        description=(
            "Bullet list of top 3-5 risk items. For each, name the asset by its type "
            "(e.g. 'Water Pumping Station') plus its pretty region label, service "
            "population, and — if it falls within a historic cone footprint — say so explicitly."
        ),
    )
    recorded_actions: list[str] = Field(
        ...,
        description=(
            "Actions actually recorded in the audit log context supplied below. "
            "Never invent an action. If none are provided in the context, return an empty list."
        ),
    )
    recommended_actions: list[str] = Field(
        ...,
        description=(
            "Advisory actions the LLM proposes given the top risks. Prefix each with a verb "
            "in the imperative (e.g. 'Pre-position...', 'Escalate...'). These are proposals, "
            "not commitments — the emergency coordinator decides which to enact."
        ),
    )
    outlook: str = Field(
        ...,
        description=(
            "1-2 sentence look-ahead over the next 24 hours based on active alert hazard types. "
            "If a heatwave dominates, discuss heat impact — not a hurricane."
        ),
    )
