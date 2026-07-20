# PRD — Multi-Hazard Readiness & Response (pre-event MVP)

**Client:** Southeastern Grid & Water (SGW) — fictional US utility, 8M+ residents, SC/GA/NC footprint
**Engagement:** AECOM AI-enabled operational decision-support platform
**Audience:** SGW technical delivery team
**Version:** 1.1 (condensed)
**Author:** Reuben Collins
**Date:** 2026-07-15
**Companion documents:** [01_assumptions.md](01_assumptions.md), [02_mvp_workflow.md](02_mvp_workflow.md), [05_architecture.md](05_architecture.md), [06_data_model.md](06_data_model.md), [07_external_data_sources.md](07_external_data_sources.md)

---

## 1. Problem definition & business context

SGW's operational data is fragmented across four system families procured independently over decades — **GIS** (asset registry, hazard overlays; ESRI-shaped), **CMMS** (work orders, inspections; Maximo-shaped), **SCADA/IoT** (real-time telemetry) and **field operations** (crews, dispatch, reports). Each uses its own asset identifier and refresh cadence; external NOAA data (NWS, NHC, NOS CO-OPS, Digital Coast, SPC/CPC, NCEI) is consumed piecemeal. During a severe-weather event an operator consults four to seven screens to understand what is happening to which asset, with which crews, under which forecast — so the platform of record for "what's happening now" is the operator's short-term memory.

Three pressures make this a now-problem: climate-driven event frequency across the SC/GA/NC footprint (hurricane, coastal + inland flood, heatwave, wildfire — see A5), insurer and PUC demands for demonstrable resilience posture under tightening NERC CIP obligations, and rising operational cost — unplanned outages, storm overtime and reactive maintenance are the largest controllable cost lines.

**What this platform is:** an AI-enabled decision-support platform that unifies fragmented data into a single situational picture, applies the right AI technique to each sub-problem (§5), and keeps operators in control — every recommendation advisory, every action auditable.
**What it is not:** a chatbot, a resident-facing product, or a replacement for operator judgement.

---

## 2. Key assumptions & unknowns

Full register in *01_assumptions.md*. The assumptions most load-bearing for technical scoping:

| # | Assumption | If wrong, this changes |
|---|---|---|
| A1 | Personas are NOC / Emergency / Field / Maintenance — internal operational users, not the 8M residents. | Persona-specific workflows re-prioritise; a resident-facing product is fundamentally different scope. |
| A3 | SGW reference footprint is SC/GA/NC (coastal + inland). | Different footprint uses the same adapters with region-specific hazard fixtures; workflow unchanged. |
| A4 | NOAA is the reference federal data stack; adapter pattern isolates provider. | Non-US (Met Office, ECMWF, JMA) requires adapter implementations only; risk/optimisation/UI unchanged. |
| C1 | Hybrid deployment — cloud for training/batch, on-prem edge appliance at NOC for real-time inference and continuity during outages. | Cloud-only fails FERC/NERC CIP and utility resilience credibility. Cloud-native with hardened redundant WAN simplifies. |
| D1 | All AI recommendations are advisory; a human in the appropriate role must accept, override or comment before action. | Regulatory posture and adoption depend on this; not negotiable for MVP. |
| E1 | MVP is the pre-event / early-onset phase for the four named hazards, coastal + inland. | Storm-only scope under-serves inland exposure; during-/post-event are Phase 2/3. |
| E3 | Mock dataset is fragmented on purpose (multi-format, ID crosswalk, quality flags, freshness metadata). | If SGW's data is already unified, the ingestion workstream shrinks — AI portfolio and workflow unchanged. |

**Unknowns that most affect scoping** — with 15 minutes of an SGW operations director we would prioritise: (1) the single biggest pain during a major storm — *knowing*, *deciding*, or *executing*? (shifts the MVP phase); (2) which decision-support tools operators already trust (anchors change-management); (3) where SGW's data is most and least mature (reshapes the roadmap).

---

## 3. Target users, workflows & pain points

| Persona | Today's pain | What this platform gives them |
|---|---|---|
| **NOC Operations Controller** | Disconnected dashboards; no single view of asset health under weather stress | Live map with hazard-conditional risk overlay + ranked flagged-asset list + drill-down with explanation |
| **Emergency Response Coordinator** | No single operational picture; decisions rely on memory and phone calls | Shared operational view + cascading-impact chains + on-demand exec briefing draft |
| **Field Operations Supervisor** | Constant re-prioritisation; suboptimal crew placement | Optimised crew pre-positioning with trade-off transparency + accept/override workflow |
| **Maintenance Planner** | Reactive work dominates; preventative work slips when it matters most | Preventative work-order recommendations sequenced by risk × consequence |

Secondary (view-only in MVP): Regional Operations Managers, Executives (Deliverable 2 lives here), Data/GIS stewards. Residents, regulators and insurers are stakeholders, not users.

**Anchor workflow — pre-event / early-onset** (full detail in *02_mvp_workflow.md*): a weather alert or SCADA anomaly within the 72-hour horizon triggers ingestion and joins to GIS + hazard zones; hazard-conditional risk scoring ranks at-risk assets; Prophet forecasts stress, water levels and demand with uncertainty bands; dependency-graph traversal surfaces cascading impacts (substation → pumping station → hospital) and Louvain clustering groups blast-radius; the optimiser proposes crew pre-positioning; the LLM synthesises explanations citing evidence IDs; the operator accepts / overrides / comments with everything audit-logged; an executive briefing is drafted on demand.

---

## 4. Functional & non-functional requirements

### Functional requirements

**Ingestion (FR-1–7)** — ingest NWS alerts/forecasts/observations at configurable cadence; NHC cones + SLOSH layers; NOS CO-OPS water levels (anchor: Charleston Harbor 8665530); Digital Coast flood layers pre-clipped to SC/GA/NC and reprojected to WGS84; GIS registry, CMMS work orders, SCADA telemetry (quality flags preserved) and field reports. Source-specific asset IDs resolve to a canonical `asset_id` via the crosswalk; per-record freshness metadata flows through the pipeline.

**AI & analytics (FR-8–14)** — hazard-conditional risk scoring per asset with contributing factors and confidence; Prophet forecasting with weather as exogenous regressor and uncertainty bands; Prophet-residual anomaly detection on SCADA; dependency-graph traversal (networkx BFS) for cascading impacts; Louvain blast-radius clustering; OR-Tools crew pre-positioning under coverage, travel-time and shift-hour constraints; structured-output LLM explanations citing evidence IDs from every contributing source.

**Operator UI (FR-15–20)** — live map with hazard overlay + risk heatmap; ranked at-risk asset list; per-asset drill-down (score, features, dependency chain, evidence, explanation); accept / override / comment on every recommendation; immutable exportable audit log; on-demand executive briefing generation.

### Non-functional requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.9% NOC-side during declared event window; edge appliance continues if cloud unreachable |
| **Latency** | Dashboard refresh < 5 s; risk refresh < 60 s from new weather data; LLM explanation < 8 s |
| **Data freshness** | SCADA < 60 s; weather 1–6 h per product; GIS daily; CMMS 15 min; field reports < 5 min |
| **Auditability** | Every recommendation and operator action logged, immutable, exportable machine-readable |
| **Security** | NERC CIP alignment; TLS 1.3 in transit, AES-256 at rest; RBAC; MFA; secrets in HSM-backed vault |
| **Accessibility** | WCAG 2.1 AA; low-light NOC environments, operation under duress |
| **Observability** | Model drift, calibration and fairness metrics; latency SLOs; per-source data-quality alerting |
| **Scalability / portability** | Horizontal scaling of ingestion + serving; regional expansion via hazard fixtures + retrained heads; adapter pattern isolates provider for non-US deployment |

---

## 5. Proposed AI capabilities

Portfolio scoped to techniques with genuine prior applied work; per-capability rationale in *02_mvp_workflow.md*.

| # | Capability | Model family | What it does NOT do | Human validation |
|---|---|---|---|---|
| 1 | Hazard-conditional risk scoring | LightGBM + Random Forest baseline. Calibration to a true failure probability is Phase 2 (needs historical failure joins) | Emits a raw stress score, not a calibrated probability; does not decide response | Accept/override; monthly hold-out review |
| 2 | Time-series forecasting | Prophet + weather exogenous regressors + M2 tidal seasonality; SARIMAX for stationary sub-series | 80% band is nominal — empirical coverage ~58% on held-out Debby data (disclosed on Governance) | Uncertainty band surfaced in UI |
| 3 | SCADA anomaly detection | Prophet-residual + rolling-median outlier ranking | Does not attribute causes or decide dispatch | Confirm/dismiss feeds recalibration |
| 4 | Crew pre-positioning | OR-Tools VRP / Guided Local Search | Does not commit dispatch or set objective weights | Operator adjusts weights, accepts/overrides |
| 5 | Cascading impact | networkx BFS over `asset_dependencies` | Only traverses declared dependencies; no prediction | Stewards maintain graph; operator inspects chain |
| 6 | Blast-radius clustering | Louvain community detection | Groups by topology only; no prioritisation | Operator filters by cluster |
| 7 | Fairness auditing | Demographic-parity + equal-opportunity gaps by region / domain / demographics | Monitoring signal only; no direct mitigation | Model-risk committee monthly; breaches trigger recalibration |
| 8 | Copilot explanation layer | Structured-output LLM (`gpt-oss:120b` via Ollama Cloud; OpenAI fallback) | **Never produces scores, forecasts or plans** — narrates and cites only | Drift monitored via canonical eval set |
| 9 | Operator-preference alignment | Logistic regression on audit-log accept/override history — deliberately not RL (no reward signal, no exploration on real infra, interpretability required) | Bounded adjustment \|Δ\| ≤ β = 0.15; cannot flip Critical to Low; weights visible on Governance | Every decision is HITL; force-retrain requires operator action |

**LLM boundary (non-negotiable):** the LLM narrates, cites evidence and drafts; it never produces the risk score, the forecast or the optimisation plan. This split is what makes the platform defensible under model-risk review — decision support, not an ops chatbot.

**Phase 2:** hazard-onset classifier; GRU-with-exogenous forecasting where Prophet plateaus; Isolation Forest / autoencoder anomaly upgrade. **Phase 3:** computer vision over NGS post-event aerial imagery for damage assessment.

---

## 6. High-level architecture & integrations

Full detail in *05_architecture.md*; source registry in *07_external_data_sources.md*.

```
[External data]  NOAA (NWS, NHC, NOS CO-OPS, Digital Coast, SPC/CPC, NCEI)
                 SGW internal (GIS, CMMS, SCADA/IoT, field ops)
                        │
[Ingestion]      Six-adapter Hazard Data family + internal adapters
                 ID resolution (asset_id_crosswalk) · quality flags · freshness · CRS → WGS84
                        │
[Persistence]    PostgreSQL 16 + PostGIS 3.4 — GiST spatial indexes; partitioned
                 sensor_readings; JSONB LLM payloads; append-only audit_log;
                 operational_risk_snapshot materialised view
                        │
[Models]         Risk (GBM+RF) | Forecast (Prophet) | Anomaly (residual)
                 Optimisation (OR-Tools) | Graph (networkx + Louvain)
                        │
[Explanation]    Structured-output, evidence-citing LLM copilot
                        │
[API + UI]       FastAPI + React dashboard · hash-chained audit log
                        │
[Downstream]     CMMS work-order creation | dispatch handoff | exec briefing
```

**Adapters:** AlertAdapter (NWS alerts), ForecastAdapter (NWS gridpoints; HRRR/GFS Phase 2), ObservationAdapter (NWS stations + CO-OPS gauges), HazardLayerAdapter (Digital Coast, SLOSH, SPC/CPC, FEMA), TrackAdapter (NHC cones), StreamflowAdapter (National Water Model, Phase 2).

**Deployment:** hybrid — cloud (AWS / Azure GovCloud) for training, batch inference and storage; on-prem edge appliance at the NOC for real-time inference, dashboard and audit write-through, continuing to operate if the cloud is unreachable. Justified by NERC CIP obligations and resilience credibility for a utility whose product *is* resilience.

**Prototype → production:** the demo's Docker Compose stack maps 1:1 to the production AWS shape — same Postgres schema on RDS Multi-AZ, same containers on EC2 ASG behind an ALB, same hash-chained audit contract with an S3 Object Lock mirror, same `LLMProvider` adapter with Bedrock (Claude on GovCloud, PrivateLink) substituted by one environment variable, same CI eval gate. The one genuinely new workstream is real ingestion: replacing the mock generator with adapters against SGW's live GIS / CMMS / SCADA, sequenced GIS → CMMS → SCADA → Field Ops behind the same `Fetcher` protocol. Full mapping in *05_architecture.md*.

**Integrations:** ESRI-shaped GIS (ArcGIS REST + GeoJSON), Maximo-shaped CMMS (REST read/write; work-order creation on operator confirmation), SCADA historian batch + MQTT stream with quality flags, NOAA stack (REST, shapefile/KMZ, ArcGIS REST, anonymous public S3 — note `signature_version=UNSIGNED` for `noaa-nwm-pds` / `noaa-hrrr-bdp-pds`).

---

## 7. Data requirements, dependencies & quality

Full spec in *06_data_model.md* and *07_external_data_sources.md*. Eight domains: assets (GIS), maintenance (CMMS), weather + hazard (NOAA), operations (SCADA), field ops, incidents + outages, infrastructure dependencies, and reference (ID crosswalk, regions, historical events).

**Fragmented on purpose:** the mock dataset reproduces SGW's actual fragmentation — multiple formats, per-source asset IDs requiring crosswalk resolution, realistic sensor quality flags, free-text field notes. A pre-joined dataset would hide the exact integration problem the platform solves; the ingestion + ID-resolution layer delivers value before any AI is invoked.

| Risk | Mitigation |
|---|---|
| Noisy / missing sensor readings | Quality flags preserved end-to-end; anomaly detection distinguishes outlier from sensor fault |
| Stale weather data | Per-record freshness metadata; staleness surfaced beside every recommendation |
| Sparse rare-event history (Cat 3+, 100-yr floods) | Physics-informed features (elevation, flood zones, vegetation); transfer from NCEI Storm Events; uncertainty surfaced in UI |
| Model drift as climate shifts | Continuous calibration monitoring; scheduled retraining; drift alerts |
| Asset ID mismatches | Crosswalk at ingest; unmapped IDs raise a data-quality alert, never silently dropped |
| Regional imbalance (coastal better instrumented) | Fairness auditing surfaces gaps; retraining prioritises under-represented regions |

**Classification & retention:** public (NOAA) → internal (registry, work orders, rosters) → sensitive (SCADA, incident detail — NERC CIP exposure) → regulated (audit logs). Operational data and audit logs retained ≥ 7 years; model artefacts versioned indefinitely, retirement requires model-risk sign-off.

---

## 8. Security, governance & human oversight

**Regulatory frame:** NERC CIP (grid-side critical-asset obligations), state PUC reporting, SOC 2 (cloud controls), NIST AI RMF (alignment stated, not certified in MVP).

**Human-in-the-loop (non-negotiable):** every recommendation is advisory; the appropriate named role confirms before action — crew dispatch (Field Supervisor), asset shutdown (NOC Controller), public communication (Emergency Coordinator), preventative work order (Maintenance Planner). Every accept / override / comment is logged with user, timestamp, reason, and the exact model version + input features that produced the recommendation.

**Audit log:** immutable, exportable, retained ≥ 7 years — every recommendation (score, model version, features, evidence IDs), every operator action, every retraining event and calibration report, every fairness audit result.

**Model risk management:** per-region, per-hazard calibration curves with drift alerts; feature- and prediction-distribution drift monitoring; fairness gaps (demographic parity + equal opportunity) across region, utility domain and service-area vulnerability indices — breaches trigger recalibration and reviewer sign-off. Explainability is role-shaped: contributing factors for the Ops Controller, dependency chains for the Emergency Coordinator, dispatch trade-offs for the Field Supervisor, calibration + fairness dashboards for the Model-Risk Reviewer.

**Access & LLM governance:** RBAC across eight roles, MFA, least-privilege pipelines, secrets in an HSM-backed vault. LLM: structured output only, canonical eval set for drift, prompt versioning with full traceability, data-classification review before any sensitive data reaches a hosted model.

---

## 9. Success metrics, MVP scope & delivery priorities

**Success metrics — operational, not model-only.** Model metrics (AUC, MAE, Brier, forecast coverage) are inputs to the metrics that matter:

| Metric | Baseline | Target (12 months post-MVP) |
|---|---|---|
| Lead time on preventative work orders during events | *TBD from SGW data* | +48 h |
| Avoided outages per major event (customer-hours) | *TBD from SGW data* | −20% |
| MTTR during storm events | *TBD from SGW data* | −15% |
| Crew utilisation during pre-event window | *TBD from SGW data* | +25% |
| Operator time to full operational picture | 15–20 min (assumed) | < 3 min |
| Operator override rate | — | 15–25% (too low = over-trust; too high = under-value) |

**In scope (MVP):** pre-event / early-onset phase; four hazards; SC/GA/NC footprint; Hurricane Debby (Aug 2024) demo scenario + Hurricane Idalia (Aug 2023) validation reference; all nine §5 capabilities (functional, simplified where noted); operator UI with accept/override + audit log; NOAA MVP source stack.

**Out of scope (Phase 2/3):** live during-event triage; post-event CV damage assessment; cross-domain water optimisation; resident-facing communication; work-order execution tracking; hazard-onset classifier; NWM / HRRR / NGS feeds; non-US adapters (portability designed in, not built).

**Delivery priorities (by dependency and value):** 1) foundational data engineering — adapters, ID resolution, quality flags (immediate ROI before any AI); 2) risk scoring + baseline; 3) Prophet forecasting; 4) residual anomaly detection; 5) OR-Tools optimisation; 6) graph reasoning; 7) LLM explanation layer; 8) operator UI; 9) governance dashboards; 10) executive briefing view.

**Phase 2 highlights** (full list in companion docs): NWM streamflow and HRRR gridded forecasts; live during-event triage; real MCP server exposing platform tools to any MCP-compatible agent; full RBAC capability gating per persona; executed decisions wired into Maximo work-order creation and crew dispatch; cross-session agent memory. **Phase 3:** NGS emergency-response imagery with CV damage assessment; NIFC/InciWeb wildfire perimeters.

---

**Appendices:** A. Assumptions register (*01_assumptions.md*) · B. Workflow selection (*02_mvp_workflow.md*) · C. Data model (*06_data_model.md*) · D. Source registry (*07_external_data_sources.md*) · E. Architecture (*05_architecture.md*)

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-07-15 | First complete draft |
| 1.1 | 2026-07-15 | Condensed for submission — detail moved to companion docs |
