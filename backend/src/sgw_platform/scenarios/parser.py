"""Directive parser — natural language → typed ScenarioSpec.

The parser is a thin wrapper around the same LLM structured-output pattern
already used for asset explanations and executive briefings — the schema is
`ScenarioSpec`, the LLM is Ollama Cloud (gpt-oss:120b) by default.

For the three MVP preset directives the LLM is short-circuited: we already
know exactly what `ScenarioSpec` shape they should have, so paying an LLM
call to reconstruct it is waste. The presets live in ``PRESET_SPECS`` and
are the same values the frontend chip labels advertise.
"""

from __future__ import annotations

from sgw_platform.explain.provider import get_provider
from sgw_platform.observability.logging import get_logger
from sgw_platform.scenarios.spec import ScenarioSpec

log = get_logger("scenarios.parser")

SYSTEM_PROMPT = """You are the SGW scenario parser. You convert a plain-English operator directive
into a strict ScenarioSpec JSON object. Rules:

1. Pick the smallest reasonable `kind`:
   · Use "replay" when the operator names a real historic storm (Idalia, Debby, Katrina, Michael, Harvey).
   · Use "worst_case_cascade" when the operator asks about worst single-asset failure impact.
   · Use "synthesised" for hypotheticals ("if a Cat 3 hit Charleston...").

2. Fill severity ONLY when the operator provided one, using the enum values in the schema. If unspecified,
   leave severity null and use a moderate default in the runner.

3. `label` MUST be 3-15 words, imperative-mood, describing what the scenario tests.

4. `surge_lift_pct` and `within_cone_ratio` are ONLY set for kind="synthesised".
   Higher categories → higher values. Cat 1 ≈ 0.2 / 0.3, Cat 3 ≈ 0.6 / 0.8, Cat 5 ≈ 0.95 / 1.0.

5. `notes` is a short free-text disclaimer of the ONE most load-bearing assumption you made.

6. `path_template_hint` — pick the map path template that best matches the described trajectory,
   from this fixed library. Only these enum values are valid:
     · "hurricane_idalia_2023"    — Gulf approach, Big Bend FL landfall, Cat 3.
     · "hurricane_debby_2024"      — Gulf approach, Big Bend FL landfall then Carolina stall, Cat 1.
     · "hurricane_matthew_2016"    — Caribbean/Bahamas approach, SC coast landfall, Cat 4.
     · "hurricane_michael_2018"    — Gulf approach, FL panhandle landfall, Cat 5.
     · "cat3_charleston_30d"       — Synthesised Atlantic approach, Charleston landfall, Cat 3.

   Pick from these cues:
     · Caribbean / Bahamas / from the south-east ocean → matthew_2016
     · Gulf of Mexico / Florida panhandle / Big Bend  → michael_2018 or idalia_2023
     · Charleston / Savannah / SC coast direct hit    → cat3_charleston_30d or matthew_2016
     · Operator names the storm                       → the matching replay entry
     · No directional/storm cue                       → LEAVE IT NULL, do not guess.

   You are NEVER allowed to emit any other string. If none fit, leave path_template_hint null.

Return ONLY the JSON object. No prose. No markdown fences.

Schema:
{schema}
"""


PRESET_SPECS: dict[str, ScenarioSpec] = {
    "replay_idalia": ScenarioSpec(
        kind="replay",
        label="Replay Hurricane Idalia (2023) against today's assets",
        hazard_type="hurricane",
        severity="cat_3",
        region_focus="COAST_EAST",
        horizon_days=7,
        reference_event="hurricane_idalia_2023",
        surge_lift_pct=0.7,
        within_cone_ratio=0.9,
        notes=(
            "Uses the real NHC track + landing surge distribution from Idalia. "
            "Projects that overlay onto the CURRENT asset registry — not the 2023 state."
        ),
        path_template_hint="hurricane_idalia_2023",
    ),
    "replay_debby": ScenarioSpec(
        kind="replay",
        label="Replay Hurricane Debby (2024) against today's assets",
        hazard_type="hurricane",
        severity="cat_1",
        region_focus="COAST_EAST",
        horizon_days=7,
        reference_event="hurricane_debby_2024",
        surge_lift_pct=0.5,
        within_cone_ratio=0.85,
        notes=(
            "Debby was a Cat-1 landfall in Florida's Big Bend but the surge signature "
            "on the Charleston Harbor gauge exceeded forecast band. Replays that overlay "
            "onto the CURRENT asset registry."
        ),
        path_template_hint="hurricane_debby_2024",
    ),
    "cat3_charleston_30d": ScenarioSpec(
        kind="synthesised",
        label="Cat 3 hurricane landfall at Charleston, +30 days",
        hazard_type="hurricane",
        severity="cat_3",
        region_focus="COAST_EAST",
        horizon_days=30,
        reference_event=None,
        surge_lift_pct=0.6,
        within_cone_ratio=0.85,
        notes=(
            "Synthesised cone geometry from HURDAT2 climatology (planned integration). "
            "Feature perturbations applied only to Coastal East assets."
        ),
        path_template_hint="cat3_charleston_30d",
    ),
    "worst_case_cascade": ScenarioSpec(
        kind="worst_case_cascade",
        label="Worst single-asset cascade over the next month",
        hazard_type=None,
        severity=None,
        region_focus=None,
        horizon_days=30,
        reference_event=None,
        surge_lift_pct=None,
        within_cone_ratio=None,
        notes=(
            "No hazard perturbation. Ranks assets by preventative_priority × downstream cascade depth "
            "so the operator sees the highest single-asset failure impact under baseline conditions."
        ),
        path_template_hint=None,
    ),
}


async def parse_directive(directive: str) -> ScenarioSpec:
    """Parse a natural-language operator directive into a strict ScenarioSpec.

    Uses the schema-in-prompt-AND-format pattern (verified in Phase 0 for gpt-oss:120b).
    Falls back to a synthesised no-hazard spec if the LLM output fails Pydantic
    validation twice.
    """
    provider = get_provider()
    schema_str = ScenarioSpec.model_json_schema()
    system = SYSTEM_PROMPT.format(schema=schema_str)
    try:
        result = await provider.chat_structured(ScenarioSpec, system, directive)
        assert isinstance(result, ScenarioSpec)
        log.info("scenarios.parse.ok", kind=result.kind, label=result.label)
        return result
    except Exception as exc:  # noqa: BLE001 — deliberate: never let LLM issues break the endpoint
        log.warning("scenarios.parse.fallback", error=str(exc))
        return ScenarioSpec(
            kind="synthesised",
            label=f"Operator directive: {directive[:60]}",
            hazard_type=None,
            severity=None,
            notes="LLM parse failed — running with neutral defaults; recommendation reflects baseline.",
        )
