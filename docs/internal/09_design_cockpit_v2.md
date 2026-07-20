# Design v2 — Storm Cockpit (adopted 2026-07-17)

**Status:** Adopted as the primary landing UX. Replaces the v1 dense operator dashboard.
**Source bundle:** [.claude/design/refres_v1/SGW Cockpit v2.dc.html](../.claude/design/refres_v1/) (exported from claude.ai/design)
**Companion:** CLAUDE.md (kept local, gitignored) design principles, [docs/03_prd.md](03_prd.md) §5 LLM boundaries

## What changed and why

| Aspect | v1 (SGW Operator Dashboard) | v2 (Storm Cockpit) |
|---|---|---|
| Landing surface | Map + ranked list + alerts stack | **Single "Priority decision"** — top asset, LLM recommendation, drivers, sparkline, action bar |
| Chrome | Left sidebar + top ribbon | No sidebar — nav lives in the top command bar |
| Temporal awareness | "T-54h" pill in ribbon | **TimelineSpine** — hour ticks, event dots (advisory, surge, tide-band, crew go, WO lock, peak), NOW playhead, Landfall marker |
| Map | Dominates the overview | Compact 340×150 mini-map in the rail with **EXPAND ↗** to full-screen |
| Watchlist | Right-column ranked list (dominant) | Right-rail rank 2-N (context, not focus) |
| Palette | Blue/purple with storm-purple accents | Darker (`#0a0b0d`), **amber as signature CTA**, IBM Plex Sans/Mono |
| Signature motif | Risk-score bar chart | 5-block **ConfidenceMeter** + amber-left-border **CopilotPullQuote** |
| Action affordance | Accept / Override / Comment | **Accept & task crew** (primary amber) · Override · Defer to #2 |

### Why the shift is right for the AECOM technical challenge

The brief is explicit: this is an **AI-enabled operational decision-support platform, not a chatbot**. v2 delivers that framing more directly:

1. **Opens with the decision, not the map.** First frame of the demo answers *"what does AI recommend I do right now?"*
2. **Copilot pull-quote makes the LLM's role visually distinct.** Amber accent, "Copilot recommends" eyebrow, evidence chips — the operator sees the LLM as advisory over structured evidence, never as a producer of scores.
3. **Timeline spine surfaces temporal reasoning.** Every AI capability has a temporal position — when the risk model fired (Advisory 15 tick), when the anomaly showed up (Tide↑band), when the operator's decision window closes (Crew go, WO lock), when the event peaks (Peak surge).
4. **Confidence as first-class.** Discrete 5-block meter conveys the *class* of confidence at a glance, complementing the numeric score.
5. **"Defer to #2" is the concrete HITL story.** The AI has ranked all candidates, but the operator drives ordering.
6. **Driver bars show the risk model is feature-attributed.** Governance narrative visible on the landing page.

All 8 AI capabilities from [docs/03_prd.md §5](03_prd.md) still visible on the cockpit landing:

| Capability | Where it appears on the cockpit |
|---|---|
| Hazard-conditional risk scoring | Big score in the hero + colour-coded ramp everywhere |
| Time-series forecasting | Compact water-level sparkline (Charleston Harbor gauge) |
| SCADA anomaly detection | Amber circles on the sparkline where observed exits the 80% band |
| Copilot (LLM) explanation | CopilotPullQuote with evidence citation chips |
| Dependency-graph cascade | "Roper Regional Hospital" driver row + `◆ cluster #7` footer |
| Louvain blast-radius clustering | Cluster tag in the action-bar footer, mirrored in watchlist |
| Fairness / governance | Model provenance footer + Governance top-nav item |
| Calibration | 5-block ConfidenceMeter |

## Architecture

The v2 shell is a single vertical stack. Everything else is a screen.

```
┌──────────────────────────────────────────────────────────────────────┐
│  CommandBar    (SGW · storm label · nav · personas · UTC clock)      │
│  StatusStrip   (Models ready · lgbm-cal-v1 · ROC-AUC · Brier · …)    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Screen (Cockpit | Full map | Crew plan | Briefing | Audit | Gov)    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

The old sidebar is deliberately gone. The cockpit's thesis is "one decision at a time" — a persistent left rail added visual noise that competed with the focus lane.

### Cockpit screen anatomy

```
┌─── Countdown + stats + TimelineSpine ───────────────────────────┐
├─── Focus lane (fills) ─────────────────┬── Rail (340px) ─────── ┤
│  Priority decision (hero asset)        │  Live threat map       │
│  · IDs · elevation · surge dist        │  · cone + track        │
│  Score + ConfidenceMeter               │  · asset heat dots     │
│  CopilotPullQuote (LLM)                │                        │
│  "Why it's #1" drivers                 │  Watchlist rank 2-N    │
│  Water-level sparkline                 │                        │
│  Action bar (Accept / Override / Defer)│                        │
└────────────────────────────────────────┴────────────────────────┘
```

## Files

**New primitives:**
- [components/TimelineSpine.tsx](../frontend/src/components/TimelineSpine.tsx) — horizontal SVG spine with hour ticks, event dots, NOW playhead, Landfall marker. Data-driven: caller passes `events: SpineEvent[]`.
- [components/ConfidenceMeter.tsx](../frontend/src/components/ConfidenceMeter.tsx) — 5-block discrete meter with `role="meter"`, plus `meterLevelFromProbability()` helper.
- [components/CopilotPullQuote.tsx](../frontend/src/components/CopilotPullQuote.tsx) — amber-left-border recommendation card with evidence chips. Only renders prose + citations (never numeric outputs).
- [components/ExplainPopover.tsx](../frontend/src/components/ExplainPopover.tsx) + [lib/explanations.ts](../frontend/src/lib/explanations.ts) — the "?" trigger + popover that renders the four-section explainer (Model · What it tells you · How to read it · Confidence) for any AI-produced surface. Full pattern documented below.

**New page:**
- [pages/CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx) — composes the focus lane + rail. Wires the store's `focusedAssetId` to the watchlist, sparkline, drivers, copilot, and action bar.

**Rewritten:**
- [App.tsx](../frontend/src/App.tsx) — sidebar removed, nav + personas + clock moved into the CommandBar.
- [index.css](../frontend/src/index.css) — IBM Plex fonts, amber signature palette, `sgw-lbl` eyebrow utility, tighter panel greys.
- [index.html](../frontend/index.html) — Google Fonts preconnect + IBM Plex.

**Extended:**
- [components/WaterLevelChart.tsx](../frontend/src/components/WaterLevelChart.tsx) — `compact` mode drops legend + axes so the same chart works as both the drill-down chart and the cockpit sparkline.
- [components/TimelineSpine.tsx](../frontend/src/components/TimelineSpine.tsx) — landfall marker + pre-Now shading now optional (live mode disables both); accepts `formatTick` for day-scale live timelines; `ariaLabel` overrideable.
- [stores/appStore.ts](../frontend/src/stores/appStore.ts) — added `focusedAssetId` + `setFocusedAsset`.

**New for mode-aware framing:**
- [lib/priority.ts](../frontend/src/lib/priority.ts) — `computePreventativeScore`, `rankByPreventative`, and `fallbackPreventativeRecommendation` (client-side sentence template used when the LLM hasn't yet returned for a preventative candidate).

**Shared helpers:**
- [lib/asset.ts](../frontend/src/lib/asset.ts) — `buildCrosswalk` + `buildDrivers` + `FEATURE_DISPLAY`. Reused by CockpitPage and AssetDrilldown.

## Non-negotiable design principles enforced by the code

Cross-referenced with CLAUDE.md (kept local, gitignored):

1. **LLM as copilot, not producer.** `CopilotPullQuote` renders only the recommendation string + evidence chips. It has no numeric slot. The risk score, confidence meter, drivers, and sparkline all live outside the pull-quote and are populated by structured backend endpoints.
2. **Every recommendation is advisory.** The action bar is always visible below the pull-quote — Accept / Override / Defer are peer buttons, none is auto-applied.
3. **Confidence surfaced, not hidden.** `ConfidenceMeter` renders next to every score. `role="meter"` + `aria-valuenow` makes it discoverable to AT.
4. **Evidence citation.** Every LLM recommendation renders the evidence IDs it referenced. Chips are `.sgw-mono` for scannability.
5. **Fragmented-on-purpose data.** The hero's ID row shows all four source-system IDs (`SGW-WAT-CO0002 · GIS-WAT-0002 · MAX-…-… · SCADA-WAT-CO0002`) explicitly — the crosswalk is a *feature*, not something to hide.
6. **Immutable audit.** The Accept flow calls `POST /api/decisions`, which writes to the append-only `audit_log` table. The returned hash is rendered in the decided pill.

## Mode-aware framing (LIVE NWS vs DEBBY 2024 REPLAY)

The cockpit exposes two operator framings behind the mode toggle in the command bar:

| | DEBBY 2024 REPLAY | LIVE NWS |
|---|---|---|
| Top-of-page anchor | `54h 12m until landfall` countdown | `No current threats · N preventative candidates ranked` |
| Timeline window | −54h → +18h with `Landfall` red marker + amber pre-Now shading | −7d → +30d with amber Now playhead only |
| Timeline events | NHC advisories + Prophet band-cross + crew go / WO lock + peak surge | Last advisory expired + Prophet re-fit + SCADA anomaly + scheduled maintenance + next retrain |
| Ranking | Hazard-conditional risk `risk_score` (LightGBM output verbatim) | Preventative priority `= 0.55 · P(failure) + 0.45 · consequence` ([lib/priority.ts](../frontend/src/lib/priority.ts)) |
| Hero score label | `Failure prob · 72h` | `Preventative priority` |
| Hero explainer | `risk_score` | `preventative_priority` |
| Drivers surface | "Why it's #1 today" — model-derived top features × per-asset values | "Priority decomposition" — the four components that sum to the priority (probability, criticality, population, cluster size) |
| Mini-map overlay | NHC cone + track visible | Cone hidden (no active storm) |
| Watchlist heading | `by risk` | `preventative priority` |
| Primary action | `Accept & task crew` | `Accept & queue work order` |
| Defer wording | `Defer to #2` | `Defer to next candidate` |
| Copilot pull-quote fallback | (LLM only) | Client-side template if LLM slow — matches maintenance framing |

### The preventative-priority formula

```
consequence = 0.45 · normalised(criticality_rating)
            + 0.35 · normalised(log10(1 + service_population) / log10(1 + 100_000))
            + 0.20 · normalised(cluster_size / 12)

preventative_priority = 0.55 · P(failure) + 0.45 · consequence
```

**Honesty guarantees:**

- The probability side is verbatim from the calibrated LightGBM model — no re-scoring, no re-weighting.
- The consequence side is a **display-time weighting** clearly labelled as such in the `preventative_priority` explainer. The 55 / 45 split and the 45 / 35 / 20 sub-split are demo defaults and a production version would tune them against SGW's actual maintenance-outcome data (or replace with a proper economic-consequence model).
- The score ramp (rose / orange / amber / slate) is identical to the risk-badge ramp so the operator's visual grammar carries between modes.

### Why this matters for the AECOM demo

A live-mode cockpit that still said *"54h until landfall"* when there's no storm was the single largest correctness gap in the shipped demo. Fixing it also unlocks the *preventative maintenance planner* narrative — the second half of the value story that a resilience-focused utility platform has to tell. The two modes now share the same primitives (TimelineSpine, ConfidenceMeter, CopilotPullQuote, ExplainPopover) but tell the two different operational stories the brief calls for.

## Explain-anywhere pattern

Every AI-produced surface renders a subtle "?" chip that opens a fixed-shape
popover explaining the model behind it. The pattern:

- **Primitive**: [components/ExplainPopover.tsx](../frontend/src/components/ExplainPopover.tsx) — trigger + panel + a11y (aria-expanded on trigger, role="dialog" with aria-labelledby, ESC + click-outside + focus return, focus moved into CLOSE on open).
- **Catalog**: [lib/explanations.ts](../frontend/src/lib/explanations.ts) — one entry per `SurfaceKey` with four sections and a short provenance pointer. All copy lives here so it's reviewable in one PR.

**Same four sections everywhere** — operators build one mental model, not one per surface:

| Section | Answers |
|---|---|
| Model | Which model family / library / version produces this |
| What it tells you | The one operator-facing job of the surface |
| How to read it | Interpretive rules — colours, thresholds, layout |
| Confidence | How uncertainty is expressed + optional **live diagnostic** (current value) |

The **live diagnostic** is a small strong callout inside the Confidence section. Callers pass a `diagnostic` string that summarises the current state — e.g. the water-forecast explainer shows `LIVE · 49 history points · updated just now`, and the score explainer shows `0.91 (critical) ±0.05`. This keeps the *what does the model say right now* answer next to the *how do you interpret the model* answer.

**Surfaces wired** (14 in total across cockpit + drilldown):

| Surface | Key | Location |
|---|---|---|
| Operational timeline | `timeline_spine` | Cockpit top row (storm mode) |
| Baseline operational picture | `live_baseline` | Cockpit top row (live mode) |
| Calibrated failure probability | `risk_score` | Cockpit hero (storm mode) + drilldown score card |
| Preventative priority | `preventative_priority` | Cockpit hero + drivers + watchlist (live mode) |
| Confidence meter | `confidence_meter` | Cockpit hero |
| Copilot recommendation | `copilot_recommendation` | Cockpit focus lane |
| "Why it's #1" drivers | `feature_drivers` | Cockpit focus lane (storm mode) |
| Water-level forecast | `water_forecast` | Cockpit sparkline + drilldown chart |
| Threat / operational map | `mini_map` | Cockpit rail |
| Watchlist | `watchlist` | Cockpit rail (storm mode) |
| Model provenance | `model_provenance` | Drilldown |
| Feature contributions | `feature_contributions` | Drilldown |
| Dependency cascade | `dependency_cascade` | Drilldown |
| Evidence citations | `evidence_citations` | Drilldown |

**Adding a new surface** takes three lines:
1. Add a `SurfaceKey` and matching entry to `EXPLANATIONS` in `lib/explanations.ts`.
2. Drop `<ExplainPopover surface="…" diagnostic={…} />` next to the section eyebrow.
3. (Optional) if the surface lives inside a `<SectionHeader>` or `<SectionLabel>`, use the built-in `explainSurface` prop instead of inlining.

## Testing

- **Unit** — [src/components/TimelineSpine.test.tsx](../frontend/src/components/TimelineSpine.test.tsx), [src/components/ConfidenceMeter.test.tsx](../frontend/src/components/ConfidenceMeter.test.tsx), [src/components/ExplainPopover.test.tsx](../frontend/src/components/ExplainPopover.test.tsx) (a11y + keyboard + click-outside + catalog integrity), [src/App.test.tsx](../frontend/src/App.test.tsx). 28 tests total. Run: `pnpm vitest run --pool=threads`.
- **Smoke** — [frontend/tests/smoke/](../frontend/tests/smoke/) is a `playwright-cli` runbook driving the full decision flow against an in-page fetch shim (mocked Debby scenario). Verified explainer triggers count == 8 on the cockpit, dialog opens on click, live diagnostic renders, ESC dismisses.
- **Screenshots** — `tests/smoke/screenshots/cockpit_landing_ashley.png`, `cockpit_accepted_scrolled.png`, `explain_water_forecast.png`, and `data_sources_live.png` captured on the last successful smoke run.

## Backend impact

Zero. Every data point the cockpit consumes was already served by v1:

- `/api/status` — model + graph metrics in the status strip
- `/api/assets` — hero + watchlist + mini-map dots
- `/api/assets/{id}` — features, cascade, evidence
- `/api/assets/{id}/explanation` — LLM recommendation for the pull-quote
- `/api/governance/model` — feature importances driving the "Why it's #1" bars
- `/api/forecasts/water-level` — sparkline
- `/api/decisions` — accept/override writes to the append-only audit log

The one thing not yet backed by a live endpoint is the timeline event list — it's currently a `DEBBY_EVENTS` constant in [CockpitPage.tsx](../frontend/src/pages/CockpitPage.tsx). A Phase-4-adjacent endpoint (`/api/scenario/timeline`) would source these from ingested NHC advisories + model firing timestamps + operational deadlines.
