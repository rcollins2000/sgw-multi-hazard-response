# SGW Storm Cockpit — end-to-end demo walkthrough

**Audience:** AECOM reviewer + utility operations stakeholders.
**Duration target:** 8–10 minutes of screen time.
**Companion runbook:** [demo/README.md](README.md) (how to start the stack).

This document is the **narration script** for the demo video. For every AI capability the platform ships, it answers the same five questions:

1. **What does it do?** — one sentence, jargon-controlled.
2. **Why is it included?** — which operator question it answers.
3. **Why is it worthwhile?** — the value delta over doing nothing.
4. **What are the limitations?** — honest failure modes.
5. **Where does the human still come in?** — the HITL touch point.

Every capability on the demo screen has this shape because the platform's design principle is *"the LLM/ML is a copilot, not the product — every recommendation is advisory, evidence-cited, and audit-logged"* ([CLAUDE.md](../CLAUDE.md) §Non-negotiable design principles).

---

## Table of contents (screen order)

1. [Landing on the cockpit — LIVE mode](#1-landing-on-the-cockpit--live-mode)
2. [Preventative priority score](#2-preventative-priority-score)
3. [Feature drivers · why it's #1 today](#3-feature-drivers--why-its-1-today)
4. [Confidence meter](#4-confidence-meter)
5. [Copilot recommendation](#5-copilot-recommendation)
6. [Water-level forecast + anomaly detection](#6-water-level-forecast--anomaly-detection)
7. [Live threat map + mode toggle](#7-live-threat-map--mode-toggle)
8. [Operator-alignment layer (preference calibration)](#8-operator-alignment-layer-preference-calibration)
9. [Discuss with copilot — asset-scoped agent chat](#9-discuss-with-copilot--asset-scoped-agent-chat)
10. [Accept / Override / Defer — HITL + immutable audit](#10-accept--override--defer--hitl--immutable-audit)
11. [Scenario agent — replays, stress tests, worst-case cascade](#11-scenario-agent--replays-stress-tests-worst-case-cascade)
12. [Storm-path templates + LLM-inferred paths](#12-storm-path-templates--llm-inferred-paths)
13. [Full map — dependency graph + blast-radius clusters](#13-full-map--dependency-graph--blast-radius-clusters)
14. [Crew plan — VRP optimisation](#14-crew-plan--vrp-optimisation)
15. [Executive briefing — LLM structured output](#15-executive-briefing--llm-structured-output)
16. [Governance — calibration, fairness, alignment](#16-governance--calibration-fairness-alignment)
17. [Audit — SHA-256 hash-chained ledger](#17-audit--sha-256-hash-chained-ledger)
18. [Data sources popover — provenance for every feed](#18-data-sources-popover--provenance-for-every-feed)

Rough time budget: 30-40 seconds per numbered section.

---

## 1. Landing on the cockpit — LIVE mode

**Say:** "SGW's operators land here. LIVE mode is default — the platform is talking to real NOAA endpoints right now."

**What it does.** LIVE polls NWS active alerts every 60 seconds and NOS CO-OPS Charleston Harbor water levels every 6 minutes, and shows what the utility should focus on *right now* — either a real hazard or, in fair weather, the highest-priority preventative maintenance targets.

**Why included.** The utility manager's first question every shift is *"what should I care about today?"*. The cockpit answers it in a single glance without them having to piece it together from a dozen dashboards.

**Why worthwhile.** In fair weather the alternative is a spreadsheet — no ranking, no evidence, no confidence signal. The cockpit compresses that to one hero card and one watchlist.

**Limitations.** LIVE mode with no active hazard shows "No active severe hazards" and pivots to preventative priorities. That's honest, but it's less visually compelling than a storm scenario — hence the DEBBY replay toggle for demos + stress tests.

**HITL touch point.** Every ranking is advisory. The operator always chooses the asset to focus on next (via the watchlist) and always owns the Accept/Override/Defer decision.

---

## 2. Preventative priority score

**Say:** "The big number is the priority score, on a 0–1 scale. Above 0.75 is critical."

**What it does.** Combines the calibrated LightGBM failure probability with a consequence weighting — criticality rating (45%), service population (35%), blast-radius cluster size (20%) — into a single ranked score. Formula: `0.55·P(failure) + 0.45·consequence`.

**Why included.** In fair weather, ranking by hazard-conditional risk alone flattens — every score compresses toward baseline. The maintenance-planner question isn't *"which asset is most at risk right now?"* — it's *"which asset should we improve NEXT to buy down the most future harm?"*.

**Why worthwhile.** Consequence-weighting means a substation serving 80,000 residents beats a pump station serving 2,000, at the same failure probability. That aligns platform output with what operators already reason about intuitively.

**Limitations.** The 45/35/20 split is a starting weight — production would tune it against SGW's actual outcome data (which doesn't exist yet, since this is a fictional utility).

**HITL touch point.** Click any watchlist row to refocus the cockpit. The operator decides the ordering they trust; the platform explains the ordering it computed.

---

## 3. Feature drivers · why it's #1 today

**Say:** "The bars underneath explain WHY this asset ranks first. Distance to surge zone, ground elevation, condition score, criticality rating."

**What it does.** Renders per-asset feature drivers from the LightGBM feature-importance table (`/api/governance/model`), sized + coloured by the specific asset's feature values.

**Why included.** No AI recommendation is worth acting on if the operator can't tell WHY. The driver bars answer that inline, without a separate drill-down.

**Why worthwhile.** Every driver is a data point the operator can independently verify — surge-zone distance is on the GIS layer, condition score is in the inspection history, criticality is in the asset registry. Nothing here is a black-box output.

**Limitations.** Feature importance is a global signal (across all training rows). Per-asset local attribution (SHAP) is Phase 2.

**HITL touch point.** The operator sanity-checks the drivers against their domain knowledge before Accepting. If a driver looks wrong, they can Override with a reason and that reason feeds the alignment layer (§8).

---

## 4. Confidence meter

**Say:** "Five blocks — 3 lit is medium confidence, 5 lit is very high. Never Accept a critical asset below 3 without asking the copilot."

**What it does.** Discretises two signals into a 5-block gauge: (a) how far the calibrated probability sits from 0.5, and (b) how tight the calibration confidence interval is around it.

**Why included.** The numeric CI (`±0.05`) is precise but not glanceable. The meter is a semaphore — screen-reader-legible ("high confidence" not just "high") and doesn't rely on colour alone.

**Why worthwhile.** Operators triage under time pressure. The gauge makes the "should I even trust this?" question a peripheral-vision judgement.

**Limitations.** Discretisation loses information — a "medium" covers a wide band. When precision matters, the numeric CI is right next to it.

**HITL touch point.** Low-confidence recommendations should trigger a Discuss-with-copilot conversation before Accepting (§9).

---

## 5. Copilot recommendation

**Say:** "The amber-bordered pull-quote is the LLM's recommendation. Every evidence chip is an ID the operator can look up — alerts, work orders, sensor readings, field reports."

**What it does.** Runs `gpt-oss:120b` (Ollama Cloud) under strict structured output — Pydantic schema in both the `format=` parameter AND the system prompt, verified in [Phase 0 smoke test](../docs/00_working_notes.md). Returns a JSON blob: `recommendation` + `evidence[]` + `confidence_reasoning`.

**Why included.** The LLM is the only capability that can synthesise "here's how you should act on this" across disparate data types — an NWS alert, an asset registry, a work-order queue, a SCADA anomaly. That's a copilot job, not a ranker job.

**Why worthwhile.** The narrative + evidence chips turn a bare score into an actionable summary the operator can defend to their manager or auditor.

**Limitations.** The LLM does NOT produce scores, forecasts, classifications, or optimisation plans — it narrates *over* those. Any structured output failure falls back to a deterministic template. Every evidence ID is verified against the source system before render (hallucinated IDs are dropped server-side).

**HITL touch point.** The recommendation is advisory — the operator can Accept it, Override with their own reasoning, or Defer. Every decision is audit-logged.

---

## 6. Water-level forecast + anomaly detection

**Say:** "This is Charleston Harbor gauge 8665530 — real NOAA data. In LIVE mode this is current tide; toggle to DEBBY mode and it's the actual storm-surge signature from Aug 2024."

**What it does.** Fits Meta Prophet on the CO-OPS observed history (with semi-diurnal M2 tidal seasonality as an exogenous regressor), forecasts 12 hours ahead with an 80% uncertainty band, flags residual anomalies via rolling-median outlier ranking.

**Why included.** The operator's second question during a storm response is *"is the storm surge coming in higher than forecast?"* — that's a residual-anomaly question, not a forecast question.

**Why worthwhile.** Prophet is boring but honest. It has real uncertainty bands, real anomaly signals. The chart differs between LIVE (calm current tide) and DEBBY (six-foot storm surge) — same widget, distinctly different signals.

**Limitations.** Prophet handles seasonality well but is not a physics model — a truly novel event (Hurricane Sandy trajectory) would produce an underconfident forecast. For those situations the platform routes to the scenario agent (§11) rather than trusting the forecast.

**HITL touch point.** Anomaly dots are annotations, not alarms. The operator decides whether to escalate. The `?` explainer surface documents exactly how the anomaly threshold is derived.

---

## 7. Live threat map + mode toggle

**Say:** "The mini-map is a react-leaflet tile. LIVE mode shows the SGW footprint and top-priority preventative candidates. DEBBY mode overlays the actual NHC cone + track from Aug 2024."

**What it does.** Interactive-disabled leaflet map with tiles from CartoDB dark. In storm mode: cone polygon (dashed amber), track polyline (solid amber), landfall marker, top-N at-risk asset dots. In LIVE mode: dots only, sized by preventative priority.

**Why included.** Text-based rankings don't answer "where?". Operators reason geographically — a substation cluster near a landfall point reads differently to a scattered set across three states.

**Why worthwhile.** Same widget in both modes = zero cognitive tax when toggling.

**Limitations.** The mini-map is a summary tile. Full pan/zoom + layer control is on the "Full map" nav tab (§13).

**HITL touch point.** Clicking `EXPAND ↗` takes the operator to the full react-leaflet view when they need to actually work with the map.

---

## 8. Operator-alignment layer (preference calibration)

**Say:** "This is the preference-calibration layer — a corrective nudge that learns from every Accept, Override, and Defer. It is NOT full reinforcement learning, and I want to explain why."

**What it does.** Fits a small logistic regression on `(asset features, was_deferred_or_overridden)` from the audit log. Outputs `P(operator defers | features)` and applies a **bounded** additive nudge to the base priority: `adjustment = -β · (2p − 1)` with `|Δ| ≤ β = 0.15`. Auto-retrains every 3 decisions. See [docs/13_operator_alignment.md](../docs/13_operator_alignment.md) for the full technical explanation.

**Why included.** Without this loop, operator decisions are dead-ends — audit-logged but not learned from. The platform sees you Defer the same shape of asset five times and… does nothing next time. Closing that loop is table stakes for a platform that claims to be "AI-enabled".

**Why worthwhile.** The layer is:
- **Bounded** — `|Δ| ≤ 0.15`. Cannot flip a Critical to Low. Cannot make the model diverge.
- **Interpretable** — StandardScaler-normalised LR weights, visible on the Governance page. Every learned rule is inspectable.
- **Auditable** — model version is a SHA of the training data; every retrain is traceable.
- **Reversible** — Force retrain against corrected decisions and the layer relearns.

**Why NOT full reinforcement learning.**

1. **No reward signal.** RL learns from outcomes materialising after the action ("did the asset actually fail?"). Operator preferences are not outcomes; treating them as such is a category error.
2. **No exploration/exploitation.** RL requires suboptimal actions to learn. Recommending low-priority assets to real utility infrastructure to see what happens is unacceptable.
3. **Sample regime.** RL needs thousands of interactions. Realistic operator decision volume is tens per week — three orders of magnitude short.
4. **Audit posture.** RL policies are hard to explain. The PRD requires every recommendation to be explainable. A LR nudge is trivially inspectable.

Framing this as RL would be marketing over honesty. The pattern is **preference calibration** (Christiano et al. 2017 lineage) / **RLHF-lite** — the same architecture as ChatGPT alignment (preference model → policy nudge), scaled down to a bounded LR corrective.

**Limitations.**
- Small-sample regime; `fit_score` is train-set accuracy (optimistic).
- No temporal decay — old decisions weighted the same as new.
- Single global model — no per-operator or per-persona split.
- Reason text is stored in audit log but not yet used as a feature (LLM-bucketing is the obvious extension).
- Can amplify operator bias — the fairness auditor is the counterweight.
- Cold-start: dormant until ≥ 8 decisions with mixed outcomes.

**HITL touch point.**
- Every decision is HITL — the layer only exists because the operator decides.
- Explain popover shows what the layer has learned before the operator acts on it.
- Bounded correction means the operator always sees the base score AND the alignment nudge separately (`0.84 → 0.78`).
- Force retrain button on the Governance page — a human has to press it (or wait for the N-decision auto-retrain).
- Governance page renders feature-weight bars — any auditor can point at what the layer has learned.

---

## 9. Discuss with copilot — asset-scoped agent chat

**Say:** "The Discuss button opens a chat scoped to THIS asset. The agent has tool access to the trained model, the dependency graph, live NWS alerts, and the asset registry — memory resets when the focused asset changes."

**What it does.** Streams responses from `gpt-oss:120b` via `POST /api/agent/chat/stream` with `asset_id` context. The agent can call tools: `lookup_asset`, `trace_cascade`, `fetch_alerts`, `explain_model`. Every tool call and result is shown inline as a badge.

**Why included.** A single recommendation can't answer every operator question. Chat covers the long tail — *"why exactly is this asset flagged?"*, *"what's downstream if it fails?"*, *"how does the risk model work in plain English?"*.

**Why worthwhile.** Tool calling means the agent grounds every claim in the same data the operator sees. There's no separate LLM knowledge base; it's the same registry, same graph, same model.

**Limitations.** The chat is scoped per asset — cross-asset conversations reset when the focused asset changes. This is deliberate (prevents context bleed) but occasionally frustrating.

**HITL touch point.** The chat can suggest actions but never execute them. The `Execute →` button on a chat-produced recommendation posts the same `/api/decisions` call as the manual Accept — the operator still owns the decision.

---

## 10. Accept / Override / Defer — HITL + immutable audit

**Say:** "Every AI recommendation ends in one of three operator actions. Accept, Override with a reason, or Defer with a reason. All three write to an append-only, SHA-256-hash-chained audit log."

**What it does.** `POST /api/decisions` writes to `operator_decisions` (linked to prediction ID) AND to `audit_log` (with SHA-256 hash chain). Both tables have BEFORE UPDATE/DELETE triggers that raise — the ledger is enforced at the DB layer, not just at the application layer.

**Why included.** Regulatory + audit posture. AI-enabled decisions in critical infrastructure need forensic reconstruction — "on this date, at this time, this operator saw this recommendation, based on this evidence, and chose this action, and here's the hash proving it wasn't modified".

**Why worthwhile.** Immutability isn't a nice-to-have for utilities under NERC-CIP-style scrutiny; it's the difference between "the audit found an issue" and "the audit couldn't find anything to audit".

**Limitations.** The append-only guarantee is enforced by triggers — DB superusers could still bypass. Production would use row-level security + separate write credentials.

**HITL touch point.** The AI cannot Accept its own recommendation. Every decision requires an operator + optional reason. The decision + reason becomes training data for the alignment layer (§8).

---

## 11. Scenario agent — replays, stress tests, worst-case cascade

**Say:** "The scenario agent answers the third operator question — *what would happen if?*. Four presets and a free-text directive. Every run uses the same trained risk model against a mutated feature frame."

**What it does.** Three-stage pipeline:
- **Parse** — free-text → `gpt-oss:120b` structured output → typed `ScenarioSpec`. Presets short-circuit the LLM.
- **Run** — copy `STATE.features`, apply hazard perturbation (surge lift, cone ratio), `risk_model.predict_proba(mutated)`.
- **Narrate** — `gpt-oss:120b` narrates the top-N impacts + drafts a recommendation citing ONLY asset IDs present in the ranked list.

See [docs/11_scenario_agent.md](../docs/11_scenario_agent.md).

**Why included.** Live monitoring answers "what now?". Preventative priority answers "what next?". The scenario agent answers "what if?" — resilience planning, historic replay, stress test. Utilities need all three.

**Why worthwhile.** Same model, same features, same evidence citations, same HITL contract — the scenario page is not a separate mental model, it's the same platform with hypothetical inputs. Every scenario run is audit-logged with a `scenario_id`.

**Limitations.** Scenarios are controlled perturbations of the model's inputs — they are NOT re-training. Real out-of-distribution shocks (novel hurricane trajectories, cascading multi-hazard events) would still show up as underconfident. The "Stress test · not a live forecast" chip on every scenario page enforces this framing.

**HITL touch point.** Scenario recommendations use the same Accept / Override / Comment HITL panel. Accepting means "queue the recommended preventative work orders", which is written to the audit log.

---

## 12. Storm-path templates + LLM-inferred paths

**Say:** "The map above the impacts is a real storm cone. Presets map to hand-digitised NHC tracks — Debby 2024, Idalia 2023, Matthew 2016, Michael 2018 — and free-text directives get an LLM-inferred path from a bounded template library."

**What it does.** Each preset attaches a `path_template_hint` field to the resolved `ScenarioSpec`. For free-text directives, the LLM parser picks from a fixed enum of five templates based on directional cues (*"Caribbean approach"* → Matthew, *"Gulf Cat 5"* → Michael). The frontend renders cone + track + landfall on a react-leaflet map.

**Why included.** The scenario impacts list is meaningless without geographic context — *"25 assets impacted"* is abstract; *"25 assets in the cone of a Cat 3 landing near Charleston"* is actionable.

**Why worthwhile.** LLM path inference is bounded to a fixed template enum, not free GeoJSON generation. That means the operator sees a plausible historic-shaped cone, not an LLM hallucination. Provenance chip on the map is explicit: `Historic replay · NHC track` vs `Synthesised composite · HURDAT2-shaped` vs `LLM-inferred cone · directive-derived`.

**Limitations.** The template library is small (5 entries). Genuinely novel trajectories fall back to the closest match — not a full synthesised cone. HURDAT2-parameterised composites are Phase 2.

**HITL touch point.** The provenance chip is always visible. The operator knows whether they're looking at a real historic path or an inferred approximation before Accepting.

---

## 13. Full map — dependency graph + blast-radius clusters

**Say:** "The Full map tab is where the operator plans in detail. Cone overlay, hazard zones, asset dots colour-coded by risk, and Louvain community-detection clusters — assets that would fail together."

**What it does.** Full-screen react-leaflet with layered toggles: NHC cone + track, flood/surge zones, asset risk heatmap, weather radar (placeholder). Assets are dots sized by risk score, coloured by risk level. Blast-radius clusters (computed by networkx BFS + Louvain community detection, modularity 0.90 across 26 clusters) are visible in the drill-down.

**Why included.** Some questions are geographic — "which assets share a substation dependency?" — and can't be answered from a ranked list.

**Why worthwhile.** Louvain modularity of 0.90 means the graph naturally partitions into meaningful clusters. That's a real signal for the crew planner (§14) — dispatch to a cluster, not just to a single asset.

**Limitations.** The dependency edges are synthetic (SGW is a fictional utility). Production would need the real GIS asset connectivity, work-order dependency chains, and substation feed diagrams.

**HITL touch point.** Every dot is clickable → drill-down → same Accept / Override / Defer contract as the cockpit.

---

## 14. Crew plan — VRP optimisation

**Say:** "Crew plan runs a real vehicle-routing-problem solver — OR-Tools with Guided Local Search, Haversine distance, real crew locations. It's optimisation, not the LLM."

**What it does.** OR-Tools VRP solver against real geographic distances, respecting crew home bases, vehicle capacity, and preventative-priority weights. Returns tours + total cost + expected coverage.

**Why included.** Once the platform tells the operator WHICH assets to prioritise, the operator's next question is HOW to dispatch. VRP is the standard tool for that class of problem.

**Why worthwhile.** The alternative is manual routing on a whiteboard. OR-Tools with GLS produces near-optimal tours in seconds; even a 5-10% cost reduction over manual planning is significant across an event.

**Limitations.** The VRP formulation assumes deterministic travel times. Real dispatch under a hurricane deals with flooded roads, downed trees, dynamic re-routing. Phase 2 wires the solver to real-time road-closure feeds.

**HITL touch point.** The output is a proposed dispatch plan, not an executed one. The crew supervisor still confirms each assignment.

---

## 15. Executive briefing — LLM structured output

**Say:** "The Briefing tab is a two-paragraph situation summary the operations manager can forward to leadership. Structured JSON output from gpt-oss:120b, Pydantic-validated."

**What it does.** `POST /api/briefing/generate` calls `gpt-oss:120b` with a strict schema. Returns headline + situation summary + top risks + recorded operator actions + recommended actions + outlook. Fully-cited — every fact traces to a source row.

**Why included.** Utility operations managers spend a non-trivial fraction of their shift writing summaries for the C-suite. This drafts one in seconds.

**Why worthwhile.** Structured output means the briefing is consistent shift-over-shift — same sections, same evidence pattern. Reviewer / auditor can compare briefings across events.

**Limitations.** LLM-drafted text still needs a human editor before it goes to the CEO. The Briefing tab shows an `Edit before send` action for a reason.

**HITL touch point.** Every briefing is drafted, not sent. The operator reviews, edits, and forwards. The final briefing (post-edit) is audit-logged.

---

## 16. Governance — calibration, fairness, alignment

**Say:** "Governance is where the platform meets the auditor. Risk-model calibration, regional fairness auditing, and the operator-alignment layer's learned weights — all inspectable."

**What it does.** Three sections:
- **Risk model** — version, ROC-AUC, Brier score, feature importances.
- **Regional fairness** — demographic parity + equal opportunity gap across regions. Target < 0.20; currently 0.086 and 0.094 respectively.
- **Operator-alignment layer** — fitted-state, sample count, feature weights (diverging bars: amber = increases P(defer), green = increases P(accept)), Force retrain button.

**Why included.** "Trust me" doesn't cut it for AI in critical infrastructure. Every model — including the alignment layer — has to be inspectable in one place.

**Why worthwhile.** Fairness gaps are auditable across regions. Alignment weights are auditable across features. The operator (or an external reviewer) can point at exactly what any model has learned.

**Limitations.** The fairness audit is on the base model — Phase 2 extends it to score the *aligned* model too, in case the alignment layer amplifies operator bias.

**HITL touch point.** The Force retrain button on the alignment section — a human has to press it. Models don't silently update.

---

## 17. Audit — SHA-256 hash-chained ledger

**Say:** "Every AI recommendation, every operator action, every scenario run — one immutable ledger. UPDATE and DELETE are blocked at the database trigger level."

**What it does.** `audit_log` table with columns: `timestamp, user, action_type, subject_id, model_version, prompt_version, features_hash, previous_hash, current_hash, payload (JSONB)`. Every row's `current_hash = SHA256(previous_hash || row_payload)`. BEFORE UPDATE and BEFORE DELETE triggers raise unconditionally.

**Why included.** Utility ops under NERC-CIP-style scrutiny need forensic reconstruction. The audit ledger IS that reconstruction primitive.

**Why worthwhile.** Any downstream question — "why did we accept this recommendation last Thursday?" — is answerable in one SQL query, and provably tamper-evident.

**Limitations.** Enforced by triggers, not row-level security. A superuser with malicious intent could still bypass. Production would layer RLS + separate write credentials.

**HITL touch point.** The Audit tab is the operator's own record. They can point at their own decision history when defending an action.

---

## 18. Data sources popover — provenance for every feed

**Say:** "Every data feed is listed here with its kind — LIVE, ARCHIVED, STATIC REF, SYNTHETIC, TRAINED, PLANNED — its provider, its cadence, and its poller freshness."

**What it does.** `GET /api/data-sources` returns the full feed registry with real freshness telemetry — `last_success`, `last_error`, `cycle_count`, `last_row_count`. The popover polls it every 15 s so freshness stays honest.

**Why included.** The reviewer's most cynical question is "is any of this real?". The data-sources popover is the direct answer — every LIVE feed has a real poller state; every SYNTHETIC feed is honestly labelled.

**Why worthwhile.** No hidden mocks, no marketing framing. If a feed is a placeholder for Phase 2, it renders under "PLANNED" and is visually dimmed.

**Limitations.** Placeholder feeds (hazard-zone polygons, historic outage joins) still exist. They are documented as PLANNED, not hidden.

**HITL touch point.** N/A — this surface is a transparency artifact, not a decision surface.

---

## Closing beat

**Say:** "Every capability you saw is layered on the same design principles — the LLM is a copilot, never the product; every recommendation is advisory; every decision is HITL and audit-logged; every model — including the alignment layer — is inspectable in Governance. This is what an AI-enabled operational platform for a utility should look like: not a chatbot, not a black box — a co-pilot with an audit trail."

---

## Numbers to reference in the video

- **32 backend + 31 frontend tests, all green** as of 2026-07-19.
- **Postgres**: 22 tables · 7 monthly `sensor_readings` partitions · 1 materialised view · 6 append-only triggers · 4 GiST spatial indexes.
- **Ingested**: 210 assets · 300 work orders · 500 inspections · 14,448 SCADA readings · 130 dependency edges · 210 crosswalk rows · 2,880 real weather observations · 24 active NWS alerts · 2 hurricane tracks.
- **Models**:
  - Risk — LightGBM + isotonic calibration + Random Forest baseline. ROC-AUC 0.80. Brier 0.18.
  - Forecasting — Prophet with M2 tidal seasonality. MAPE 0.18. 80% band coverage 0.58.
  - Anomaly — Prophet residual outlier ranking.
  - Optimisation — OR-Tools VRP + Guided Local Search.
  - Graph — networkx BFS + Louvain community detection. Modularity 0.90 across 26 clusters.
  - Fairness — demographic parity 0.086, equal opportunity 0.094 (target < 0.20).
  - **Alignment — sklearn LogisticRegression + StandardScaler, bounded corrective nudge β = 0.15, min 8 samples to fit.**
- **LLM**: Ollama Cloud, `gpt-oss:120b`, structured output via schema-in-prompt-AND-format pattern, Pydantic validation with corrective retry.
- **Audit**: SHA-256 hash chain across every AI recommendation and operator action; UPDATE/DELETE blocked at trigger level.
