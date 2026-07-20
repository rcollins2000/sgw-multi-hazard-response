# Scenario agent

**Status:** Landed 2026-07-18.
**Companion:** [docs/05_architecture.md](05_architecture.md)

## The question this answers

The live cockpit already answers *"what's happening now?"* and *"what should we improve next?"*. The scenario agent answers the third operator question — *"what would happen if X?"* — by letting the operator run **hypothetical scenarios** against the same trained risk model.

Three MVP directives cover the shape of the ask:

- **Replay**: *"How would Idalia (2023) hit us if it happened next week?"*
- **Stress-test**: *"What if a Cat 3 landed at Charleston in 30 days?"*
- **Worst-case cascade**: *"What's our worst single-asset failure impact under baseline conditions?"*

## Data flow

```
Operator directive (free-text OR preset key)
       │
       ▼
[Directive parser]        LLM structured output → typed ScenarioSpec
       │                  (preset short-circuits the LLM call)
       ▼
[Scenario runner]         Copy STATE.features → apply hazard perturbation →
       │                  STATE.risk_model.predict_proba(mutated)
       ▼
[Impact ranker]           delta = scenario − baseline; combine with
       │                  consequence + cascade depth
       ▼
[Report generator]        LLM narrates over top-N impacts, cites
       │                  ONLY asset IDs present in the ranked list
       ▼
POST /api/scenarios/run   → ScenarioReport payload + audit_log entry
       │
       ▼
Frontend renders          spec panel · ranked impacts · CopilotPullQuote
       │                  · narrative · HITL panel (accept/override/comment)
       ▼
POST /api/scenarios/{id}/decision → audit_log entry
```

Every step's shape is a Pydantic model on the backend and a matching TypeScript type on the frontend — no untyped JSON crosses the wire.

## Files

**Backend — new [`sgw_platform/scenarios/`](../backend/src/sgw_platform/scenarios/):**
- [`spec.py`](../backend/src/sgw_platform/scenarios/spec.py) — `ScenarioSpec`, `ScenarioImpact`, `ScenarioReport`, `ScenarioRequest` (Pydantic).
- [`parser.py`](../backend/src/sgw_platform/scenarios/parser.py) — `parse_directive(text) → ScenarioSpec` via the schema-in-prompt-AND-format LLM pattern; `PRESET_SPECS` short-circuits three MVP presets.
- [`runner.py`](../backend/src/sgw_platform/scenarios/runner.py) — mutates the live features frame (surge distance, cone membership, alert-area membership) then calls the trained risk model. `worst_case_cascade` skips perturbation and ranks by preventative-priority × cascade depth.
- [`report.py`](../backend/src/sgw_platform/scenarios/report.py) — LLM narration + recommendation + evidence (with hallucinated-ID guard-rail; drops any evidence entry not in the ranked_impacts list).

**Backend — modified:**
- [`api/routes.py`](../backend/src/sgw_platform/api/routes.py) — `GET /api/scenarios/presets`, `POST /api/scenarios/run`, `POST /api/scenarios/{id}/decision`. Every run writes `scenario_generated` to the audit log; every decision writes `scenario_{accept|override|comment}`.

**Frontend — new:**
- [`pages/ScenariosPage.tsx`](../frontend/src/pages/ScenariosPage.tsx) — preset chips + free-text directive input + resolved-spec panel + impacts list + CopilotPullQuote + narrative + HITL panel.
- `scenario_analysis` entry in [`lib/explanations.ts`](../frontend/src/lib/explanations.ts) — the explainer for the whole surface. Catalog is now 15 keys, all covered by [`ExplainPopover.test.tsx`](../frontend/src/components/ExplainPopover.test.tsx).

**Frontend — modified:**
- [`App.tsx`](../frontend/src/App.tsx) — new `Scenarios` nav item + route.
- [`lib/api.ts`](../frontend/src/lib/api.ts) — added `ScenarioReport`, `ScenarioImpact`, `ScenarioSpec`, `PresetKey`, `scenarioPresets()`, `runScenario()`, `scenarioDecide()`.

## How the scenario runner conditions the model

The MVP does **not** retrain a scenario-conditioned model — that would require labelled outcomes for each scenario type, which SGW (fictional) doesn't have. Instead the runner does the smallest defensible thing:

1. Copy the live `features` DataFrame.
2. For hurricane / flood scenarios, mutate three columns on a deterministic subset of assets in the target region:
   - `within_hurricane_cone` → 1
   - `within_active_alert_area` → 1
   - `min_dist_to_surge_zone_m` and `min_dist_to_flood_zone_m` → reduced proportional to `surge_lift_pct`
3. Call `STATE.risk_model.predict_proba(mutated)`.
4. Compute `delta = scenario_score − baseline_score` per asset.
5. Rank by a scenario-kind-specific weighting:
   - `replay` / `synthesised` → delta dominates (0.5 · scenario + 0.3 · delta + 0.15 · consequence + 0.05 · cascade)
   - `worst_case_cascade` → consequence + cascade dominate (0.4 · priority + 0.4 · consequence + 0.2 · cascade)

**Determinism.** Given the same `ScenarioSpec` and `STATE.features`, the runner produces the same ranked impacts. Audit-log entries include the fully-serialised spec so re-runs are byte-for-byte reproducible.

## LLM guard-rails

Two failure modes are handled defensively so the endpoint never returns a broken payload:

- **Directive parser fallback** ([`parser.py`](../backend/src/sgw_platform/scenarios/parser.py) → `_fallback_spec`): if the LLM output fails Pydantic validation twice, the parser returns a neutral synthesised spec so the operator gets *something* to inspect + refine.
- **Report evidence guard** ([`report.py`](../backend/src/sgw_platform/scenarios/report.py) → post-validation): every `evidence[]` entry the LLM returns is checked against the `ranked_impacts` list. Hallucinated IDs are dropped silently; if all are dropped, the top-3 impact IDs are substituted so the operator still sees evidence.

Both fallbacks are logged (`scenarios.parse.fallback`, `scenarios.report.fallback`) so ops can catch model regressions.

## HITL + audit

The scenario page's HITL row calls `POST /api/scenarios/{id}/decision` with `action ∈ {accept, override, comment}`. Every call writes a `scenario_{action}` row to the append-only `audit_log`. For the MVP, `accept` means *"add the recommended preventative work orders to the queue"* — the queue itself is a Phase 2 endpoint, so the audit-log entry IS the receipt.

## Roadmap (deliberately deferred)

- **Multi-turn refinement** — "OK now do that with a Cat 4 instead" — the existing streaming agent chat has the plumbing; wiring it to scenario spec editing is a small follow-up.
- **Real counterfactual inference** — a scenario-conditioned model with proper labels + causal decomposition. Needs data infra work + a labelled dataset.
- **HURDAT2 climatology** — the `cat3_charleston_30d` synthesised cone uses hand-tuned coefficients; replacing them with real return-period distributions from HURDAT2 is a small backend job once the adapter lands (declared as `planned` in `/api/data-sources`).
- **NGS post-event imagery + CV comparison** — scenario runs could be validated against actual outcomes when NGS imagery becomes an ingested source (Phase 3 CV workflow in the PRD).
- **Scenario-conditioned LLM prompt variants** — the report generator uses one system prompt; extending to a `scenario_kind`-specific prompt would sharpen the narrative.
- **Fairness auditing on scenario runs** — pipe the impacted-asset set into the existing fairness auditor so the operator sees "this scenario disproportionately impacts region X". The fairness code exists; just needs a wiring pass.

## Testing

- **Unit**: catalog integrity test in [`ExplainPopover.test.tsx`](../frontend/src/components/ExplainPopover.test.tsx) now includes `scenario_analysis` (15 surfaces total). 31 tests total.
- **Smoke**: `frontend/tests/smoke/install_mocks.js` mocks `/api/scenarios/presets`, `/api/scenarios/run`, and `/api/scenarios/{id}/decision`. Verified flow: navigate to Scenarios → click Cat 3 @ Charleston preset → ranked impacts render (3 rows) → CopilotPullQuote renders the recommendation + evidence chips → Accept flow produces the `Scenario accept · logged to audit <hash>` pill.
- **Screenshots**: `demo/screenshots/scenarios_report.png` (preset spec panel + directive input) and `demo/screenshots/scenarios_impacts.png` (ranked impacts + copilot + HITL) captured on the last successful run.
