# PRD — Multi-Hazard Readiness & Response (pre-event MVP)

**Client:** Southeastern Grid & Water (SGW) — fictional US utility, 8M+ residents, SC/GA/NC footprint
**Engagement:** AECOM AI-enabled operational decision-support platform
**Audience:** SGW technical delivery team
**Version:** 1.0 (first complete draft)
**Author:** Reuben Collins
**Date:** 2026-07-15
**Companion documents:** [00_working_notes.md](00_working_notes.md), [01_assumptions.md](01_assumptions.md), [02_mvp_workflow.md](02_mvp_workflow.md), [06_architecture.md](06_architecture.md), [07_data_model.md](07_data_model.md), [08_external_data_sources.md](08_external_data_sources.md)

---

## 1. Problem definition & business context

### The operational problem
SGW's operational data is fragmented across four system families that were procured independently over decades:

- **GIS** — asset registry, service areas, hazard overlays (ESRI-shaped)
- **CMMS** — work orders, inspection history, asset condition (Maximo-shaped)
- **SCADA / IoT** — real-time telemetry on grid, water and wastewater assets
- **Field operations** — crew rosters, dispatch status, field reports

Each system uses its own asset identifier and its own refresh cadence. External weather and hazard data (NOAA — NWS, NHC, NOS CO-OPS, Digital Coast, SPC/CPC, NCEI) is consumed piecemeal. During a severe-weather event an operator must consult four to seven independent screens to understand what is happening to which asset, in which service area, with which crews available, under which forecast.

This fragmentation manifests as:
- **Reactive rather than proactive posture** — the platform of record for "what's happening now" is the operator's short-term memory, not a system
- **Slower situational awareness during events** — assembling the operational picture is manual
- **Under-utilised historical data** — inspection records, prior incidents and forecast performance rarely inform live decisions
- **No shared operational language** across the NOC, emergency coordination, field ops and maintenance teams

### Business context
Three converging pressures make this a now-problem:

1. **Climate-driven event frequency and severity** — SGW's SC/GA/NC footprint faces increasing exposure to hurricanes, coastal + inland flooding, heatwaves and wildfire (see Assumption A5)
2. **Insurance premiums and regulatory scrutiny** — utility insurers and PUCs increasingly require demonstrable resilience posture; NERC CIP tightens grid-side obligations
3. **Rising operational cost** — unplanned outages, storm-response overtime, and reactive maintenance are the largest controllable cost lines

### What this platform changes
An AI-enabled operational decision-support platform that:
- Unifies fragmented data into a single situational picture
- Applies AI capabilities appropriate to each sub-problem (hazard-conditional risk scoring, time-series forecasting, anomaly detection, optimisation, dependency reasoning, LLM explanation) — see §5
- Keeps operators in control — every AI recommendation is advisory, every action is auditable
- Provides a common operational vocabulary across NOC, emergency coordination, field ops and maintenance

**What this platform is not:** a chatbot, a resident-facing product, or a replacement for operator judgement. The brief explicitly describes an "AI-enabled decision-support platform" and this PRD scopes accordingly.

---

## 2. Key assumptions & unknowns

Full register in [01_assumptions.md](01_assumptions.md). The seven assumptions most load-bearing for technical scoping:

| # | Assumption | If wrong, this changes |
|---|---|---|
| A1 | Users are SGW operational staff, not the 8M residents. Residents are beneficiaries. | UX, auth, deployment model, accessibility scope all shift |
| A5 | SGW reference footprint is SC/GA/NC (coastal + inland). | Different footprint uses the same adapters with region-specific hazard-layer fixtures; workflow unchanged |
| A6 | NOAA is the reference federal data stack; adapter pattern isolates provider for non-US deployment. | Non-US (Met Office, ECMWF, JMA) requires adapter implementations only; no change to risk/optimisation/UI |
| C1 | Hybrid deployment — cloud for training/batch inference, on-prem edge appliance at NOC for real-time inference and continuity during outages. | Cloud-only fails FERC/NERC CIP and utility resilience credibility. If SGW is cloud-native with hardened redundant WAN this simplifies. |
| D1 | All AI recommendations are advisory; a human in the appropriate role must accept, override or comment before action. | Regulatory posture and adoption depend on this; not negotiable for MVP |
| E1 | MVP is the pre-event and early-onset phase for the four named hazards (hurricane, flood, heatwave, wildfire), coastal + inland. | Storm-only scope would under-serve inland exposure; during-event/post-event phases are Phase 2/3 |
| E3 | Mock dataset is fragmented on purpose (multi-format, ID crosswalk, quality flags, freshness metadata). | If SGW's data is already unified in a lake/warehouse, ingestion workstream shrinks — AI portfolio and workflow unchanged |

### Unknowns that most affect scoping
If a 15-minute conversation with an SGW operations director were available before build, we would prioritise:

1. What is SGW's single biggest operational pain during a major storm — *knowing what's happening*, *deciding what to do*, or *executing the response*? (Shifts the MVP phase)
2. What decision-support tools already exist that operators trust? (Anchors change-management)
3. Where is SGW's data most mature and most immature? (Directly reshapes the roadmap)

---

## 3. Target users, workflows & pain points

### Primary users (four personas)

| Persona | Today's pain | What this platform gives them |
|---|---|---|
| **NOC Operations Controller** | Too many disconnected dashboards; no single view of asset health under weather stress | Live map with hazard-conditional asset risk overlay + ranked flagged-asset list + drill-down with explanation |
| **Emergency Response Coordinator** | No single operational picture; response decisions rely on memory and phone calls | Shared operational view + cascading-impact chains (dependency graph) + on-demand exec briefing draft |
| **Field Operations Supervisor** | Constant re-prioritisation as events unfold; suboptimal crew placement | Optimised crew pre-positioning recommendations with trade-off transparency + accept/override workflow |
| **Maintenance Planner** | Reactive maintenance dominates; preventative work slips when it matters most | Preventative work-order recommendations from hazard-conditional risk scoring, sequenced by risk × consequence |

### Secondary users (view-only in MVP)
- **Regional Operations Managers** — regional dashboards showing risk posture, KPIs, workforce utilisation, preparedness
- **Executives** — strategic resilience metrics, financial impact, major-incident summaries (Deliverable 2 lives here)
- **Data / GIS / Asset Engineers** — data stewards; interact with the platform's data-quality dashboards rather than the operational UI

### Stakeholders (not users)
Residents, customers, regulators, insurers, the public. All benefit from improved outcomes but do not interact with the platform.

### Anchor workflow — pre-event / early-onset
1. Weather alert (NWS/NHC) or SCADA anomaly signals an emerging hazard within the 72-hour horizon
2. Platform ingests the alert, joins to GIS + hazard zones + asset registry
3. Hazard-conditional risk scoring produces ranked at-risk assets
4. Prophet time-series forecasts asset stress, water levels and demand with uncertainty bands
5. Dependency-graph traversal surfaces cascading impacts (substation → pumping station → hospital)
6. Louvain community detection groups assets into blast-radius clusters
7. Optimiser proposes crew pre-positioning across the affected region
8. LLM synthesises structured explanations citing evidence IDs from every source
9. Operator drills in, accepts / overrides / comments — audit log records everything
10. Executive briefing view aggregates impact; LLM drafts a summary paragraph on demand

Full workflow in [02_mvp_workflow.md](02_mvp_workflow.md).

---

## 4. Functional & non-functional requirements

### Functional requirements (as user-story-shaped items)

**Ingestion**
- FR-1 As a data engineer, I can ingest weather alerts, forecasts and station observations from the NWS API at configurable cadence
- FR-2 As a data engineer, I can ingest NHC hurricane cones and SLOSH surge layers as static fixtures + live advisories
- FR-3 As a data engineer, I can ingest NOS CO-OPS water levels at named tide gauges (anchor: Charleston Harbor 8665530)
- FR-4 As a data engineer, I can pre-clip Digital Coast flood-exposure layers to the SGW footprint (SC/GA/NC), reproject to WGS84 and load as `hazard_zones.geojson`
- FR-5 As a data engineer, I can ingest asset registry (GIS), work orders (CMMS), SCADA telemetry (with quality flags) and field reports (structured + free text)
- FR-6 As the platform, I resolve source-specific asset IDs (GIS / Maintenance / SCADA / Field-Ops) to a canonical `asset_id` via the crosswalk
- FR-7 As the platform, I preserve per-record freshness metadata and per-sensor quality flags through the pipeline

**AI & analytics**
- FR-8 Hazard-conditional risk scoring produces a calibrated probability per asset given (hazard type, severity, region), with contributing factors and confidence
- FR-9 Prophet time-series forecasting produces expected trajectories with uncertainty bands for water levels, demand surge and asset stress signals, using weather as exogenous regressor
- FR-10 Prophet-residual anomaly detection flags SCADA readings falling outside the forecast's uncertainty band; anomaly score = normalised residual magnitude
- FR-11 Dependency-graph traversal (networkx BFS) surfaces cascading impacts from any flagged asset
- FR-12 Louvain community detection assigns a blast-radius cluster ID to each asset; operators can filter and prioritise by cluster
- FR-13 OR-Tools optimisation (VRP / Guided Local Search) proposes crew pre-positioning across the affected region under coverage + travel-time + shift-hour constraints
- FR-14 Structured-output LLM generates per-recommendation explanations citing evidence IDs from every contributing source

**Operator UI**
- FR-15 Live map with hazard overlay + asset risk heatmap + weather layer
- FR-16 Ranked list of at-risk assets with score, contributing factors, confidence, blast-radius cluster ID
- FR-17 Drill-down panel per asset — score, features, dependency chain, evidence, LLM explanation
- FR-18 Accept / override / comment workflow for every recommendation; all actions logged
- FR-19 Immutable, exportable audit log for regulatory review
- FR-20 On-demand executive briefing generation (LLM-drafted paragraph from current operational picture)

### Non-functional requirements

| Category | Requirement |
|---|---|
| **Availability** | 99.9% NOC-side during declared event window; edge appliance continues operating if cloud is unreachable |
| **Latency** | Dashboard refresh < 5 s; risk score refresh < 60 s from new weather data; LLM explanation < 8 s |
| **Data freshness SLA** | SCADA < 60 s; weather forecast refresh 1–6 h per product; GIS daily; CMMS 15 min; field reports < 5 min |
| **Auditability** | Every AI recommendation and every operator action logged, immutable, exportable in machine-readable form |
| **Security** | NERC CIP alignment; encryption in transit (TLS 1.3) and at rest (AES-256); RBAC by role; MFA; secrets in HSM-backed vault |
| **Accessibility** | WCAG 2.1 AA; operators may work in low-light NOC environments and under duress |
| **Observability** | Model drift, calibration and fairness metrics; latency SLOs; data-quality metrics per source; alerting on threshold breaches |
| **Scalability** | Horizontal scaling of ingestion + model serving; regional expansion by adding hazard-layer fixtures + retraining region-specific model heads |
| **Portability** | Adapter pattern isolates provider choice; non-US deployment (Met Office / ECMWF / JMA) requires adapter implementations only |

---

## 5. Proposed AI capabilities

Portfolio scoped to techniques with genuine prior applied work — see [00_working_notes.md](00_working_notes.md) *"AI portfolio scoped to defensible techniques"* for the evidence table. Full detail and per-capability rationale in [02_mvp_workflow.md](02_mvp_workflow.md).

### Portfolio at a glance

| # | Capability | Model family | What it does NOT do | Human validation |
|---|---|---|---|---|
| 1 | Hazard-conditional risk scoring | Gradient-boosted regressor (LightGBM v2) + Random Forest baseline. Real calibration to a true failure probability is Phase 2 (needs historical failure joins). | Does not decide response; does not classify hazards from raw weather. Emits a raw stress score, not a calibrated probability. | Operator accepts/overrides; monthly review of fit vs. hold-out |
| 2 | Time-series forecasting | Prophet with weather as exogenous regressor + M2 semi-diurnal seasonality; ARIMA/SARIMAX kept for stationary sub-series | Does not classify anomalies (residual anomaly is a separate capability); does not decide operational thresholds. 80% band is nominal; empirical coverage ~58% on held-out Debby data (disclosed on Governance). | Uncertainty band surfaced in UI; operator reviews flagged trajectories |
| 3 | SCADA anomaly detection | Prophet-residual + rolling-median outlier ranking — flag observations with the largest residuals against the trend | Does not attribute causes; does not decide dispatch | Operator confirms or dismisses; feeds back into model recalibration |
| 4 | Crew pre-positioning optimisation | OR-Tools VRP / Guided Local Search under coverage + travel-time + shift-hour constraints | Does not commit dispatch; does not decide objective weights | Operator adjusts weights + accepts/overrides plan |
| 5 | Dependency-graph cascading impact | networkx BFS traversal over `asset_dependencies` | Does not predict failures; only traverses declared dependencies | Data stewards maintain dependency graph; operator inspects chain |
| 6 | Failure blast-radius clustering | Louvain community detection on the dependency graph | Does not decide priority; only groups by topology | Operator filters by cluster; clusters re-computed on dependency updates |
| 7 | Regional fairness auditing (governance) | Demographic-parity + equal-opportunity gap metrics across region / domain / demographics | Does not mitigate bias directly; produces monitoring signal | Model-risk committee reviews monthly; gap thresholds trigger recalibration |
| 8 | Copilot explanation layer | Structured-output LLM (`gpt-oss:120b` via Ollama Cloud, OpenAI fallback) | **Never produces risk scores, forecasts, or optimisation plans.** Narrates and cites only. | Operator reads and can request re-generation; drift monitored via canonical eval set |
| 9 | Operator-preference alignment loop | Supervised preference learning — sklearn LogisticRegression + StandardScaler on `(asset features, was_deferred_or_overridden)` drawn from `audit_log`. Deliberately NOT reinforcement learning (no reward signal, no exploration on real infra, sample regime too small, audit posture demands interpretability). See [docs/13_operator_alignment.md](13_operator_alignment.md). | Does not replace the base ranking; adjustment bounded to \|Δ\| ≤ β=0.15. Cannot flip Critical to Low. Every learned weight is visible on Governance. | Every Accept/Override/Defer is HITL. Force-retrain requires operator action. Bounded correction preserves operator authority. |

### LLM boundaries (non-negotiable)
The LLM narrates, cites evidence, drafts and answers questions over structured retrieval. It never produces the risk score, never produces the forecast, never produces the optimisation plan, never classifies hazards. This split is defensible under model-risk-management review and is what makes this a decision-support platform rather than an ops chatbot.

### Phase 2 additions (out of MVP scope, documented for roadmap)
- **Hazard-onset classifier** — multi-source signal fusion (SCADA anomaly features + weather + geography) inferring emerging hazard type before upstream classification; complements NWS/NHC alerts
- **GRU-with-exogenous forecasting upgrade** — deep-sequence alternative to Prophet where longer-range or higher-dimensional signals justify it
- **Isolation Forest / autoencoder anomaly upgrade** — where Prophet-residual plateaus

### Phase 3 additions
- **Computer vision** over NGS post-event aerial imagery for damage assessment and restoration sequencing

---

## 6. High-level architecture & integrations

Full detail in [06_architecture.md](06_architecture.md); source registry in [08_external_data_sources.md](08_external_data_sources.md).

### Layered view

```
[External data]  NOAA (NWS, NHC, NOS CO-OPS, Digital Coast, SPC/CPC, NCEI)
                 SGW internal (GIS, CMMS, SCADA/IoT, field ops)
                                     │
                                     ▼
[Ingestion]      Six-adapter Hazard Data family + internal-source adapters
                 ID resolution / canonicalisation (asset_id_crosswalk)
                 Quality-flag preservation, freshness metadata, CRS → WGS84
                                     │
                                     ▼
[Persistence]    PostgreSQL 16 + PostGIS 3.4  (canonical operational store)
                 - Spatial: GiST indexes on assets / service_areas / hazard_zones
                 - Partitioned: sensor_readings (monthly)
                 - JSONB: LLM outputs, adapter payloads
                 - Append-only + triggers: audit_log, predictions, operator_decisions
                 - Materialised view: operational_risk_snapshot
                                     │
                                     ▼
[Feature layer]  Feature builder — SQL joins across GIS + hazard + weather + history
                                     │
                                     ▼
[Model layer]    Risk scoring (GBM+RF) | Forecasting (Prophet) | Anomaly (Prophet-residual)
                 Optimisation (OR-Tools) | Graph reasoning (networkx + Louvain)
                                     │
                                     ▼
[Explanation]    LLM copilot — structured-output, evidence-citing
                                     │
                                     ▼
[API + UI]       FastAPI + React operator dashboard (map + list + drill-down + accept/override)
                 Postgres audit log (immutable, exportable, hash-chained)
                                     │
                                     ▼
[Downstream]     CMMS work-order creation | dispatch handoff | exec briefing
```

### Six-adapter Hazard Data family

| Adapter | MVP source | Phase 2 extends to | Purpose |
|---|---|---|---|
| AlertAdapter | NWS `/alerts/active` | State/local emergency-management feeds | Classified hazard alerts → workflow trigger |
| ForecastAdapter | NWS `/gridpoints/.../forecast` | NCEP HRRR, GFS | Gridded numerical weather features |
| ObservationAdapter | NWS stations + NOS CO-OPS gauges (Charleston Harbor 8665530 anchor) | Additional gauge networks, satellite obs | Observed weather + water levels |
| HazardLayerAdapter | Digital Coast, NHC SLOSH MOM, SPC/CPC outlooks, FEMA flood zones | nowCOAST OGC services | Static + updating hazard polygons |
| TrackAdapter (hurricane-specific) | NHC forecast cone per advisory | — | Storm-track geometry during active advisories |
| StreamflowAdapter (Phase 2) | — | National Water Model | Inland flood streamflow forecasting |

### Deployment
Hybrid — cloud (AWS or Azure GovCloud) for training, batch inference, feature store, storage; on-prem edge appliance at NOC for real-time inference, dashboard and audit-log write-through. Edge continues operating if cloud is unreachable. Justified by (a) NERC CIP obligations, (b) resilience credibility for a utility whose product *is* resilience.

### Prototype → production

**The demo's Docker Compose stack maps 1:1 to the production shape** — the transition is a substitution exercise, not a rebuild. See the deployment diagram in [README.md](../README.md#production-deployment-architecture).

- **Same database** — the prototype already runs Postgres 16 + PostGIS 3.4 with declarative partitioning, materialised views, and append-only triggers. Production moves to a managed equivalent (RDS / CloudSQL / AlloyDB) with PITR, read replicas, and encryption at rest; the schema and application queries are untouched.
- **Same containers** — [backend/Dockerfile](../backend/Dockerfile) and [frontend/Dockerfile](../frontend/Dockerfile) already produce production-shaped images (multi-stage frontend → nginx serving a static bundle; backend with an idempotent seed-on-startup entrypoint that maps cleanly to a Kubernetes Job). Autoscaling on request rate is a Helm chart, not new code.
- **Same audit contract** — the SHA-256 hash-chained `audit_log` runs against the same table; production adds a write-once mirror (S3 Object Lock or QLDB) that regulators can inspect independently of the operator.
- **Same LLM adapter pattern** — the backend implements an `LLMProvider` interface with Ollama Cloud and OpenAI concrete adapters. Swapping vendors is one env var; adding a self-hosted provider (llama.cpp, vLLM) is one adapter class.
- **Same eval suite** — `tests/evals/` runs today as a CI gate on every push. Production layers continuous evaluation against production traffic samples on top of the same fixtures.
- **Secrets managed differently** — `.env` for the demo, SecretsManager / SSM / Vault in production, injected via the K8s CSI driver. Same environment-variable names; the delta is one Helm value file, not application code.
- **Observability hooks already emitted** — structlog JSON to stdout + Prometheus metrics counters wired throughout the code. Production adds a receiver: OpenTelemetry Collector → Prometheus + Grafana + Loki (or the cloud-managed equivalents CloudWatch / Cloud Monitoring).

**The one genuinely new workstream** in production is real data ingestion: replacing the deterministic mock generator ([`scripts/generate_mock_data.py`](../backend/scripts/generate_mock_data.py)) with adapters against SGW's real GIS / CMMS / SCADA. The six-adapter Hazard Data family already isolates provider choice, so this is a Phase-1 delivery — sequenced GIS → CMMS → SCADA → Field Ops — rather than an unknown. Each adapter lands behind the same `Fetcher` protocol used by the NOAA adapters today.

### Integrations
- **ESRI-shaped GIS** — read via ArcGIS REST + GeoJSON export
- **Maximo-shaped CMMS** — read/write via CMMS REST API; work-order creation on operator confirmation
- **SCADA / IoT** — historian read (batch) + MQTT stream (real-time), per-sensor quality flags preserved
- **NOAA stack** — REST (NWS, CO-OPS), shapefile/KMZ (NHC, SPC, CPC), ArcGIS REST (Digital Coast), anonymous S3 (Open Data — NWM, HRRR)

### AWS S3 access pattern (worth calling out)
NOAA Open Data lives on anonymous public S3 (`noaa-nwm-pds`, `noaa-hrrr-bdp-pds`). Boto3 requires `Config(signature_version=UNSIGNED)`, or use HTTPS S3 endpoints directly. Different from typical REST fetch.

---

## 7. Data requirements, dependencies & quality

Full data spec in [07_data_model.md](07_data_model.md); source registry in [08_external_data_sources.md](08_external_data_sources.md).

### Data domains
1. **Assets** (GIS) — asset registry, service areas, hazard zones. See §1 of data model.
2. **Maintenance** (CMMS) — work orders, inspection history
3. **Weather + hazard** (NOAA stack) — alerts, forecasts, observations, hazard layers, historical events
4. **Operations** (SCADA / IoT) — sensor readings with quality flags
5. **Field operations** — crews, crew status, field reports
6. **Incidents + outages** — incident records, outage records
7. **Infrastructure dependencies** — declarative dependency graph
8. **Reference** — asset ID crosswalk, region definitions, historical events

### Design principle — fragmented on purpose
The mock dataset represents SGW's actual fragmentation: multiple formats (GeoJSON, CSV, JSON, GRIB2 in Phase 2), different asset IDs per source system (crosswalk resolution required), realistic sensor quality flags, free-text field-report notes. Presenting a pre-joined dataset would hide the exact integration challenge the platform is designed to solve. The ingestion + ID-resolution layer is a technical-maturity signal in its own right, before any AI is invoked.

### Data quality risks and mitigations

| Risk | Mitigation |
|---|---|
| Sensor readings noisy or missing | Quality flags preserved through pipeline; anomaly detection distinguishes "genuine outlier" from "sensor fault" |
| Stale weather data | Per-record freshness metadata; UI surfaces staleness alongside every recommendation |
| Sparse rare-event history (Category 3+ hurricanes, 100-year floods) | Physics-informed features (elevation, flood zones, vegetation encroachment); transfer-learning from broader NCEI Storm Events dataset; uncertainty quantification surfaced in UI |
| Model drift as climate patterns shift | Continuous calibration monitoring; scheduled retraining cadence; drift alerts |
| Asset ID mismatches | Crosswalk resolution at ingest; unmapped IDs raise a data-quality alert rather than silently drop |
| Regional data imbalance (coastal better instrumented than inland) | Fairness auditing on the risk model surfaces gaps; retraining prioritises under-represented regions |

### Data classification
- **Public** — NOAA source data
- **Internal** — asset registry, work orders, crew rosters
- **Sensitive** — SCADA telemetry, incident details (potential grid-security exposure under NERC CIP)
- **Regulated** — audit logs (retention requirement per state PUC)

### Retention
- Operational data — 7 years minimum (regulatory)
- Audit logs — 7 years minimum, immutable
- Model artefacts — versioned indefinitely; retirement requires model-risk sign-off

---

## 8. Security, governance & human oversight

### Regulatory frame
- **NERC CIP** — grid-side obligations for critical asset protection, access control, incident response
- **State PUC oversight** — per-state operational reporting and rate-case implications
- **SOC 2** — cloud infrastructure controls
- **NIST AI RMF** — model-risk management framework, alignment stated but not certified in MVP

### Human-in-the-loop (non-negotiable)
Every AI recommendation is advisory. A human in the appropriate role must accept, override or comment before any operational action:
- Crew dispatch → Field Operations Supervisor confirms
- Asset shutdown → NOC Ops Controller confirms
- Public communication → Emergency Coordinator confirms
- Preventative work order → Maintenance Planner confirms

Every accept / override / comment is logged with user, timestamp, reason, and the exact model version + input features that produced the recommendation.

### Audit log
Immutable, exportable, retained ≥ 7 years. Log entries include:
- Every AI recommendation (score, model version, features, evidence IDs)
- Every operator action (accept / override / comment with reason)
- Every model retraining event and calibration report
- Every fairness audit result

### Model risk management
- **Calibration monitoring** — per-region, per-hazard-type calibration curves; drift alerts on threshold breaches
- **Drift monitoring** — feature-distribution drift + prediction-distribution drift
- **Fairness auditing** — demographic-parity and equal-opportunity gap metrics across:
  - Region (inland vs. coastal, urban vs. rural)
  - Utility domain (water vs. electrical vs. wastewater)
  - Service-area demographics (population vulnerability indices)
  - Gaps above defined thresholds trigger recalibration and reviewer sign-off before deployment. Methodology follows demographic-parity + equal-opportunity frameworks.
- **Explainability requirements per role** — Ops Controller sees contributing factors + confidence; Emergency Coordinator sees dependency chain + LLM narrative; Field Supervisor sees dispatch trade-offs; Model-Risk Reviewer sees calibration + fairness dashboards

### Access control
- RBAC by role (Ops Controller, Emergency Coordinator, Field Supervisor, Maintenance Planner, Regional Manager, Executive, Data Steward, Model-Risk Reviewer)
- MFA required for all users
- Least-privilege on ingestion pipelines
- Secrets in HSM-backed vault; no credentials in code or config

### LLM governance
- Structured output only; no free-form text influencing operational actions
- Canonical evaluation set for LLM drift monitoring
- Prompt versioning; every LLM output traceable to prompt version + model version
- Data classification review before any LLM sees sensitive data (governs data-residency choice for the hosted model)

---

## 9. Success metrics, MVP scope & delivery priorities

### Success metrics — operational, not model-only

Model metrics (AUC, F1, MAE) are inputs to the metrics that matter. The success metrics for the platform are operational:

| Metric | Baseline | Target (12 months post-MVP) |
|---|---|---|
| Mean lead time on preventative work orders during events | *TBD from SGW data* | +48 h |
| Avoided outages per major event (customer-hours) | *TBD from SGW data* | -20% |
| MTTR during storm events | *TBD from SGW data* | -15% |
| Crew utilisation during pre-event window | *TBD from SGW data* | +25% |
| Operator time to full operational picture | 15–20 min (assumed) | < 3 min |
| Operator override rate on AI recommendations | — | 15–25% (target range — too low suggests over-trust, too high suggests under-value) |

Model-level metrics tracked for internal validation:
- Risk-scoring calibration (Brier score, reliability diagram)
- Forecast MAPE + coverage of uncertainty bands
- Fairness gaps against defined thresholds

### MVP scope

**In scope for MVP:**
- Pre-event / early-onset phase of the Multi-Hazard Readiness & Response workflow
- Four hazards (hurricane, flood, heatwave, wildfire) with hazard-conditional risk scoring
- SC/GA/NC footprint
- One primary demo scenario (Hurricane Debby, August 2024) + one validation reference (Hurricane Idalia, August 2023)
- All nine AI capabilities in §5 (functional, may be simplified in the prototype)
- Operator UI with accept/override + audit log
- NOAA MVP source stack per [08_external_data_sources.md](08_external_data_sources.md)

**Out of scope for MVP (Phase 2/3 in roadmap):**
- Live during-event incident triage
- Post-event damage assessment (CV)
- Cross-domain water optimisation
- Resident-facing communication
- Work-order execution tracking
- Hazard-onset classifier
- NWM streamflow, HRRR live grids, NGS imagery
- Non-US provider adapters (portability designed in, not built)

### Delivery priorities

Ordered by dependency and value:

1. **Foundational data-engineering** — ingestion adapters, ID resolution, quality-flag preservation. Immediate ROI even before AI (collapses the "which system is right?" problem)
2. **Risk-scoring model + baseline** — GBM + RF comparison, calibration, feature importance
3. **Forecasting layer** — Prophet with weather exogenous regressors for water levels + demand + asset stress
4. **Anomaly detection** — Prophet-residual re-using the forecasting model
5. **Optimisation** — OR-Tools crew pre-positioning
6. **Graph reasoning** — dependency traversal + Louvain clustering
7. **LLM explanation layer** — structured-output copilot, evidence citation
8. **Operator UI** — map + list + drill-down + accept/override + audit
9. **Governance dashboards** — calibration, drift, fairness monitoring
10. **Executive briefing view** — regional aggregates + LLM-drafted summaries

### Phase 2 (concrete)

**Data + models:**
- National Water Model streamflow via `water.noaa.gov` derived products — inland flood forecasting
- NCEP HRRR (3 km hourly gridded forecast) — higher-fidelity forecast features
- nowCOAST OGC services — backup / cross-check
- Live during-event incident triage — anomaly detection on live SCADA telemetry
- Multi-source hazard-onset classifier
- GRU-with-exogenous forecasting upgrade where Prophet plateaus
- Isolation Forest / autoencoder anomaly upgrade where Prophet-residual plateaus
- Non-US provider adapters (Met Office, ECMWF, JMA)
- Real Digital Coast / NHC SLOSH clips for hazard zones (currently placeholder polygons)
- Real NHC forecast cone shapefile parsing per advisory (currently hand-curated fixtures)

**Agent + integrations:**
- **Real MCP server** — expose lookup_asset / cascade_from / noaa_alerts / dispatch tools via the MCP protocol. Enables any MCP-compatible agent (Claude Code, third-party analytics, other operator copilots) to interact with SGW via a standard interface. Currently tools are Python function bindings called directly by the internal agent loop.
- **Full RBAC persona gating** — MVP currently shifts the UX per persona (NOC / Emergency Coordinator / Field Supervisor / Maintenance Planner) and records persona-specific user attribution in the audit log, but any persona can execute any action. Production requires capability gating: field supervisors dispatch but can't override risk scores; only emergency coordinators trigger cross-region briefings; only NOC controllers approve grid shutdowns.
- **Executed decisions reaching external systems** — MVP captures every operator accept / override with tamper-evident audit chain. Phase 2 wires those actions into CMMS work-order creation (Maximo REST) and crew dispatch (mobile push). All the metadata to do it is already persisted.
- **Agent memory across sessions** — currently per-conversation only. Add a Postgres-backed `agent_conversations` table keyed by (persona, asset_id) so an operator returning after a shift change picks up context.
- **Streaming structured outputs** — MVP streams freeform agent chat but structured explanations + briefings still complete one-shot. Extend Ollama structured-output pattern to stream partial JSON.

### Phase 3 (concrete)
- NGS Emergency Response Imagery + CV-based damage assessment and restoration sequencing
- NIFC / InciWeb wildfire perimeter integration

---

## Appendices

- **A. Assumptions register** — [01_assumptions.md](01_assumptions.md)
- **B. MVP workflow selection with alternatives considered** — [02_mvp_workflow.md](02_mvp_workflow.md)
- **C. Data model** — [07_data_model.md](07_data_model.md)
- **D. External data source registry** — [08_external_data_sources.md](08_external_data_sources.md)
- **E. Architecture** — [06_architecture.md](06_architecture.md)
- **F. Working notes & decision log** — [00_working_notes.md](00_working_notes.md)

---

## Version history

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-07-14 | Skeleton — section intents only |
| 1.0 | 2026-07-15 | First complete draft |
