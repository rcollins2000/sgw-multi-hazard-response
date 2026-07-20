"""Versioned prompt registry.

Prompts are code. Code has versions. This registry gives every prompt in the
platform a stable identifier that:

  1. Ships alongside every LLM call in the audit log (so the exact prompt
     that produced any recommendation is recoverable weeks later).
  2. Bumps when the prompt text changes — the version string is the axis
     against which "did we ship a bad prompt?" is answered.
  3. Feeds the golden-set eval — tests are pinned to a version so a prompt
     rewrite forces a test refresh, not a silent regression.

Naming convention: <capability>-v<n> where n increments when the text
materially changes (whitespace + typo fixes don't bump the version). Ship a
short changelog line next to the constant so the diff is inspectable at a
glance.
"""

from __future__ import annotations

# ---- Explanation (per-asset LLM recommendation) ----------------------------
EXPLANATION_V = "expl-v4"
# v1: initial single-prompt implementation
# v2: added evidence-citation requirement
# v3: added "confidence_reasoning" field
# v4: added the historic-cone caveat + "never invent asset IDs" rule

# ---- Executive briefing ----------------------------------------------------
BRIEFING_V = "brief-v3"
# v1: initial four-section structure
# v2: split recorded_actions (from audit) vs recommended_actions (LLM)
# v3: added outlook + hazard-type enumeration

# ---- Scenario directive parser ---------------------------------------------
SCENARIO_PARSER_V = "sp-v2"
# v1: initial parse-to-ScenarioSpec
# v2: added path_template_hint enum with directional cues (Caribbean/Gulf/…)

# ---- Scenario report narrator ----------------------------------------------
SCENARIO_REPORT_V = "sr-v2"
# v1: initial narration
# v2: server-side drops LLM-cited asset IDs not in the ranked impacts list

# ---- Streaming copilot chat (tool-calling loop) ----------------------------
COPILOT_CHAT_V = "chat-v3"
# v1: initial system prompt + tool specs
# v2: added RECOMMENDATION: prefix convention for one-click execute
# v3: added historic-cone caveat + tool-call-before-fact rule


PROMPT_VERSIONS: dict[str, str] = {
    "explanation": EXPLANATION_V,
    "briefing": BRIEFING_V,
    "scenario_parser": SCENARIO_PARSER_V,
    "scenario_report": SCENARIO_REPORT_V,
    "copilot_chat": COPILOT_CHAT_V,
}


def get_version(capability: str) -> str:
    """Look up the current version of a named prompt. Falls back to
    'unversioned' so a caller that forgets to register produces a
    recognisable audit-log signal rather than crashing."""
    return PROMPT_VERSIONS.get(capability, "unversioned")
