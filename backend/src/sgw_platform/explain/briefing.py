"""Executive briefing generator — LLM drafts a paragraph from the operational picture."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sgw_platform.explain.provider import LLMProvider, get_provider
from sgw_platform.explain.schemas import ExecutiveBriefing


PROMPT_VERSION = "briefing-v2"

SYSTEM_PROMPT = (
    "You draft executive-level briefings for the Southeastern Grid & Water (SGW) operations "
    "leadership team. Audience: senior decision-makers, not engineers. Keep language plain, "
    "prioritise business impact + population affected, and be honest about uncertainty.\n"
    "\n"
    "Non-negotiable rules:\n"
    "- Do not invent numbers, actions, or asset names. Only use what's in the context.\n"
    "- The `recorded_actions` field must be derived STRICTLY from the audit log entries "
    "  supplied in the context. If the context shows no recorded actions, return an empty list.\n"
    "- The `recommended_actions` field is your advisory suggestions — prefix each with an "
    "  imperative verb. These are proposals for the emergency coordinator to consider, not "
    "  facts about what SGW is doing.\n"
    "- Historic hurricane cone footprints (Hurricane Debby 2024, Hurricane Idalia 2023) are "
    "  kept in the risk model as stress-test overlays. If assets fall within these cones, "
    "  disclose that context — do NOT claim an active hurricane unless the active alert list "
    "  actually contains one.\n"
    "- Name each asset by its human asset_type + pretty region, not by raw enum codes.\n"
    "- The outlook must be grounded in the active alert hazard types listed in the context.\n"
)


@dataclass
class BriefingContext:
    active_alert_count: int
    critical_assets: int
    high_assets: int
    total_service_population_at_risk: int
    top_risks: list[dict[str, Any]]  # asset_id, asset_type_label, region_label, risk_score, service_population, within_hurricane_cone
    active_hazard_types: list[str]
    model_version: str
    recorded_audit_actions: list[dict[str, Any]] = field(default_factory=list)  # user, action, subject, reason, timestamp
    cone_asset_count: int = 0
    cone_note: str = ""


def _format_context(ctx: BriefingContext) -> str:
    lines = [
        f"Active NWS alerts: {ctx.active_alert_count}",
        f"Active hazard types (from alerts): {', '.join(ctx.active_hazard_types) or 'none'}",
        f"Critical-risk assets: {ctx.critical_assets}",
        f"High-risk assets: {ctx.high_assets}",
        f"Aggregate service population potentially affected: {ctx.total_service_population_at_risk:,}",
        f"Risk model version: {ctx.model_version}",
    ]
    if ctx.cone_asset_count > 0:
        lines.append(
            f"Assets currently within a historic hurricane cone footprint: {ctx.cone_asset_count}. "
            f"{ctx.cone_note}"
        )
    lines.append("")
    lines.append("Top-risk assets:")
    for r in ctx.top_risks:
        pop = f"{r['service_population']:,}" if r.get("service_population") else "n/a"
        cone_flag = " [WITHIN HISTORIC HURRICANE CONE]" if r.get("within_hurricane_cone") else ""
        lines.append(
            f"  - {r['asset_id']} — {r['asset_type_label']} — {r['region_label']} — "
            f"risk {r['risk_score']:.2f} — pop {pop}{cone_flag}"
        )

    lines.append("")
    if ctx.recorded_audit_actions:
        lines.append("Recorded operator actions from the audit log (use these EXACTLY for recorded_actions):")
        for a in ctx.recorded_audit_actions:
            reason = f" — reason: {a.get('reason')}" if a.get("reason") else ""
            lines.append(
                f"  - {a['timestamp']}: {a['user']} performed {a['action']} on {a['subject_id']}{reason}"
            )
    else:
        lines.append("Recorded operator actions from the audit log: NONE (return an empty list for recorded_actions).")
    return "\n".join(lines)


async def generate_briefing(
    ctx: BriefingContext,
    provider: LLMProvider | None = None,
) -> ExecutiveBriefing:
    provider = provider or get_provider()
    user = _format_context(ctx)
    result = await provider.chat_structured(
        ExecutiveBriefing, SYSTEM_PROMPT, user, capability="briefing"
    )
    assert isinstance(result, ExecutiveBriefing)
    return result
