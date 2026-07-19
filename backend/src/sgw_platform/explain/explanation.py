"""LLM-generated per-asset explanations, evidence-grounded."""

from __future__ import annotations

from dataclasses import dataclass

from sgw_platform.explain.provider import LLMProvider, get_provider
from sgw_platform.explain.schemas import AssetExplanation


PROMPT_VERSION = "explanation-v1"


SYSTEM_PROMPT = (
    "You are the SGW decision-support copilot. Given a flagged asset, its risk score, "
    "the contributing factors, and evidence from real source systems, produce a concise "
    "structured explanation for the NOC operator.\n"
    "\n"
    "Rules:\n"
    "- Only cite evidence IDs that appear in the provided context. Do not invent IDs.\n"
    "- Be honest about uncertainties. If data is stale or a factor is inferred, say so.\n"
    "- Keep bullets terse. Operators are scanning under time pressure.\n"
    "- Never recommend an action the operator cannot immediately take.\n"
)


@dataclass
class ExplanationContext:
    asset_id: str
    asset_name: str
    asset_type: str
    region: str
    service_population: int | None
    risk_score: float
    contributing_factors: dict[str, float | int | str | bool | None]
    evidence: dict[str, list[str]]  # {kind: [ids]}, e.g. {"alerts": ["urn:oid:..."], "work_orders": ["WO-98421"]}


def _format_context(ctx: ExplanationContext) -> str:
    lines = [
        f"Asset: {ctx.asset_id} — {ctx.asset_name}",
        f"Type: {ctx.asset_type}",
        f"Region: {ctx.region}",
        f"Service population: {ctx.service_population}",
        f"Risk score (0-1): {ctx.risk_score:.3f}",
        "",
        "Contributing factors:",
    ]
    for k, v in ctx.contributing_factors.items():
        lines.append(f"  - {k}: {v}")
    lines.append("")
    lines.append("Evidence available (only cite these):")
    for kind, ids in ctx.evidence.items():
        lines.append(f"  - {kind}: {', '.join(ids) if ids else '(none)'}")
    return "\n".join(lines)


async def generate_explanation(
    ctx: ExplanationContext,
    provider: LLMProvider | None = None,
) -> AssetExplanation:
    provider = provider or get_provider()
    user = _format_context(ctx)
    result = await provider.chat_structured(AssetExplanation, SYSTEM_PROMPT, user)
    assert isinstance(result, AssetExplanation)
    return result
