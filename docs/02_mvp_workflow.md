# MVP workflow selection

## Recommendation

**Multi-Hazard Readiness & Response — MVP scoped to the pre-event and early-onset phase for the four hazards named in the brief (hurricane, flood, heatwave, wildfire), across coastal *and* inland regions.**

One workflow, four hazard types, three deliverables, one demo. The demo scenario uses a hurricane + flash-flood event on the coast as the most dramatic instance; the platform capability applies across all four hazards.

## Trigger

The workflow fires when either:
- **(a) An external classified alert** (NWS, NHC, USGS, state agency, or SGW's synthetic feed in the prototype) arrives naming a hazard type, region and severity, or
- **(b) SGW's internal onset detector** flags anomalous cross-source signals suggesting an emerging hazard (Phase 2 stretch — anomaly on SCADA + hot dry conditions could indicate wildfire risk before an external alert is issued)

## The workflow

```
External alerts (NWS / NHC / USGS / state agency)          Asset registry (GIS + CIM)
       │                                                             │
       ▼                                                             ▼
Hazard layers (flood zones, wildfire risk, storm surge, heat vulnerability, evacuation zones)
       │                                                             │
       ▼                                                             ▼
Historical incident + failure data                          SCADA / IoT telemetry + quality flags
       │                                                             │
       ▼                                                             ▼
       ─────────► Multi-source ingestion + asset ID resolution ◄──────
                                    │
                                    ▼
                  [Hazard-conditional risk scoring]
                  Given (hazard_type, severity, region), produce
                  per-asset risk with contributing factors + confidence
                                    │
                                    ▼
                  [Dependency graph reasoning]
                  Cascading impact — substation → pumping station → hospital
                                    │
                                    ▼
                  [Optimisation] crew pre-positioning + preventative work-order sequencing
                                    │
                                    ▼
                  [LLM layer] structured explanations, evidence citations, briefing drafts
                                    │
                                    ▼
                  Operator dashboard + accept/override + audit log ──► CMMS / dispatch
```

## Why multi-hazard, and why now

- **The brief names four hazards explicitly** across coastal *and* inland regions. A storm-only framing would under-serve inland exposure (heatwave, wildfire, inland flooding) and miss roughly half the case.
- **Different hazards drive very different asset risks:**
  - Wildfire → vegetation encroachment, transmission-line ignition risk, air-quality impact on outdoor crews
  - Flood → low-elevation pumping stations and substations, access-road inundation, water-quality risk
  - Heatwave → transformer capacity headroom, water-demand surges, mortality risk for vulnerable populations
  - Hurricane → wind + surge + rainfall combined, longest lead time, largest geographic footprint
- **One platform that reasons *conditional on hazard type*** is a much stronger technical story than four one-off models. It says: we understand the general problem structure and have a portfolio of AI capabilities we compose per hazard.

## AI capability portfolio

The brief explicitly asks for AI beyond LLMs. Portfolio scoped to techniques with genuine prior experience (see working-notes entry *"AI portfolio scoped to defensible techniques"* for evidence).

| Capability | Model family | What it produces | Why not just rules |
|---|---|---|---|
| **Hazard-conditional asset risk scoring** | Gradient-boosted classifier (LightGBM/XGBoost) + calibrated probability (isotonic regression); Random Forest as evaluation baseline | Per-asset risk score with contributing factors, given (hazard type, severity, region) | Rules can't blend continuous forecast features with categorical asset attributes and rare-event history at scale |
| **Time-series forecasting** — water levels, demand surge, asset stress trajectories | **Prophet** with weather features as exogenous regressors + seasonality tuning; ARIMA/SARIMAX for stationary sub-series | Expected trajectory + uncertainty interval for each time-series signal over the forecast horizon | Rules and static thresholds can't capture seasonality × exogenous weather × trend interactions; the uncertainty band is essential for operator decision confidence |
| **Anomaly detection on SCADA / field-ops streams** | **Prophet-residual detection** — flag readings falling outside the Prophet forecast's uncertainty band; anomaly score = normalised residual magnitude | Early operational-stress signals, independent of external alerts, with a per-timepoint expected range that adapts to seasonality and weather (via exogenous regressors) | Static thresholds ignore seasonality × weather-conditional expected ranges; a Prophet-fitted model gives a *per-timepoint* expected range that adapts. Elegant re-use of the same technique already forecasting water levels — one model, two uses. |
| **Optimisation** — crew pre-positioning | OR-Tools (Vehicle Routing Problem / Guided Local Search) under hazard-specific coverage + travel-time constraints | Crew placement plan with trade-off transparency | Manual planning doesn't scale across regions or under time pressure |
| **LLM layer** | Structured-output LLM (Claude Sonnet / GPT-4 class) | Per-recommendation explanations, cross-source evidence synthesis, operator Q&A, exec briefing drafts | LLMs are wrong producers of risk scores but great cross-source narrators |
| **Dependency-graph cascading impact** | networkx traversal (BFS from flagged node) over `asset_dependencies` | Cascading-impact chains for a flagged asset (substation → pumping station → hospital) | Included because it's essential for situational awareness — labelled as symbolic reasoning to be honest about what's ML vs. what's a useful graph algorithm |
| **Failure blast-radius clustering** | **Louvain community detection** on the dependency graph | Communities of assets that would fail together — a "blast-radius cluster" ID per asset that operators can filter and prioritise by | Rules can't discover community structure at scale; Louvain identifies clusters purely from the topology |
| **Governance — regional fairness auditing** | Demographic-parity and equal-opportunity gap metrics across regions and utility domains | Monitoring signal: does the risk model systematically under-score inland assets vs. coastal, rural vs. urban, water vs. electrical? Feeds re-calibration and reviewer sign-off. | Regulated infrastructure demands verifiable fairness across served populations; ad-hoc spot-checks are not enough |
| **Phase 2 stretch — hazard-onset classifier** | Multi-source signal fusion (GBM on SCADA anomaly features + weather + geography) | Inferred emerging hazard type from cross-source anomalies before upstream classification | Complements external NWS/NHC alerts; catches events before they're classified upstream |
| **Phase 2 stretch — deep-learning forecasting upgrade** | **GRU with exogenous variables** as an alternative to Prophet where longer-range or higher-dimensional signals justify it | Same expected-trajectory + uncertainty outputs, but leveraging deep-sequence models when Prophet plateaus | Provides a defensible upgrade path without committing to it in MVP |

**Note on LLM boundaries.** The LLM never produces the risk score, never produces the forecast, never produces the optimisation plan. It narrates, cites evidence, drafts, and answers questions over structured retrieval. This split is defensible under model-risk-management review.

## What the demo shows end-to-end

1. Operator opens dashboard → live map with weather overlay + asset risk heatmap
2. Hurricane forecast + flash-flood alert enters the 72-hour horizon → risk scores update, top-20 at-risk assets surface
3. Operator drills into a flagged pumping station → sees hazard-conditional score, contributing factors (age, flood-zone overlap, forecast surge, prior failures, overdue inspection), confidence, and dependency chain
4. LLM-generated structured explanation cites the specific evidence (weather alert, work order, sensor reading, field report) — see [07_data_model.md §9](07_data_model.md#9-curated-operational-risk-view)
5. Optimiser proposes crew pre-positioning across the affected region
6. Operator accepts two recommendations, overrides one with a comment → audit log records the decision
7. Executive briefing view shows aggregate impact + response progress + one-paragraph summary the coordinator can send to leadership

Each step maps to a section of the PRD and to a bullet in the exec briefing.

## Alternatives considered

### Alt 1 — Live during-event incident triage
- **Pros:** Highest drama, anomaly detection on live telemetry is a great AI showcase
- **Cons:** Streaming telemetry is harder to mock convincingly; the situational-awareness angle already fits in the pre-event/early-onset workflow via the risk map; hard to bound in 6 days
- **Verdict:** Phase 2 in the roadmap, don't build

### Alt 2 — Preventative maintenance risk scoring (routine, non-event workflow)
- **Pros:** Cleanest ML problem, most defensible data assumptions
- **Cons:** Doesn't land the resilience / climate narrative; feels like CMMS augmentation rather than decision-support; weaker exec briefing
- **Verdict:** The recommended workflow already surfaces preventative work orders as one output, so this is covered thematically without being the headline

### Alt 3 — Post-event damage assessment & restoration sequencing
- **Pros:** Great computer-vision angle (drone / satellite imagery); very tangible
- **Cons:** CV models are heavier to prototype credibly; imagery datasets are harder to mock; misses the *proactive* half of the brief entirely
- **Verdict:** Phase 3 in the roadmap; call out CV explicitly to signal awareness

### Alt 4 — LLM-first "ops copilot" chatbot
- **Pros:** Fastest to build
- **Cons:** Contradicts the brief's language ("decision-support platform"); fails the "AI beyond LLMs" criterion; chat is a poor UX for time-critical operational decisions
- **Verdict:** Rejected. The LLM is a *layer* in the recommended workflow, not the workflow itself.

### Alt 5 — Single-hazard (storm-only) MVP
- **Pros:** Sharper focus, easier to build
- **Cons:** Under-serves the inland regions and heatwave/wildfire risks named in the brief; misses the opportunity to show hazard-conditional generalisation; weaker technical story
- **Verdict:** Rejected in favour of the multi-hazard framing. Demo scenario is still hurricane/flood-shaped for narrative drama, but the platform capability is multi-hazard.

## What ships in the prototype (Deliverable 3)

Minimum viable:
- Synthetic multi-source dataset per [07_data_model.md](07_data_model.md) — fragmented on purpose, ID crosswalk required
- Real NOAA fixtures per [08_external_data_sources.md](08_external_data_sources.md) — Debby primary, Idalia validation
- One hurricane + flash-flood scenario (primary), one heatwave scenario, one wildfire scenario at reduced fidelity — enough to show hazard-conditional switching
- Hazard-conditional risk scoring model (GBM, calibrated) with feature-importance surfacing + Random Forest baseline for methodological rigour
- **Prophet time-series forecasting** for water levels at CO-OPS Charleston Harbor gauge with weather as exogenous regressor — uncertainty band surfaced in UI
- **Prophet-residual anomaly detection** on one SCADA sensor stream — same Prophet model that forecasts the sensor's expected trajectory flags readings outside its uncertainty band
- OR-Tools crew pre-positioning (VRP / Guided Local Search per prior TSP work)
- networkx dependency-graph traversal for cascading-impact view
- **Louvain community detection** on the dependency graph → blast-radius cluster ID visible per asset in UI
- LLM-generated explanations via hosted API, structured output, citing evidence IDs from real sources
- Web UI (Streamlit or Next.js — decide by Day 2) with map, ranked list, drill-down, accept/override, audit log

Stretch:
- Confidence calibration plot in the UI
- Fairness-audit dashboard tab — regional demographic-parity / equal-opportunity gaps on the risk model
- Executive briefing generation from the current operational picture
- Hazard-onset classifier (multi-source signal fusion) — sketched in PRD as Phase 2
- GRU-with-exogenous forecasting alternative to Prophet — sketched in PRD as Phase 2
