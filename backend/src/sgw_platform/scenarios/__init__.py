"""Scenario agent — operator directives → scenario-conditioned model runs.

An operator sends a directive (natural language OR a preset key) and the
platform returns a ScenarioReport: ranked asset impacts + an LLM-drafted
recommendation + evidence citations. The report is written to the audit
log so every scenario run is traceable to the operator + directive that
produced it.

Three scenario kinds are supported in the MVP:

    replay              — replay a historic event's overlays against today's
                          asset registry (e.g. "if Idalia hit us next week").
    synthesised         — synthesise hazard layers from severity + region
                          (e.g. "Cat 3 landfall at Charleston in 30 days").
    worst_case_cascade  — no hazard perturbation; rank assets by
                          preventative_priority × downstream cascade depth
                          (e.g. "what's our worst single-asset failure impact
                          this month?").

See docs/08_scenario_agent.md for the full pipeline + data-flow diagram.
"""

from sgw_platform.scenarios.spec import (
    ScenarioImpact,
    ScenarioReport,
    ScenarioSpec,
)

__all__ = ["ScenarioImpact", "ScenarioReport", "ScenarioSpec"]
