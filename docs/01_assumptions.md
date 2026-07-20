# Assumptions register

Every assumption below fills a gap in the brief. Each one lists **what** is assumed, **why** it's the reasonable call, and **what would change** if the assumption is wrong.

Assumptions are grouped by category. Keep this file living — add new ones as they're made, don't retrofit them into the PRD silently.

---

## A. Users, scope and business context

### A1. Personas — NOC Operations Controller, Emergency Response Coordinator, Field Operations Supervisor, Maintenance Planner
- **Why:** These four roles map cleanly onto the brief's three capability gaps (proactive risk assessment, emergency coordination, situational awareness) and the fourth (routine maintenance prioritisation) that keeps the platform earning its keep between storms. Regional managers, executives and data/GIS engineers are secondary (view-only in MVP).
- **If wrong:** Persona-specific workflows in the PRD would be re-prioritised, not re-scoped. A materially different persona set (e.g. resident-facing) would be a fundamentally different product — the current UX, auth model, and deployment posture all assume internal operational users.

### A2. SGW has an existing GIS system (likely ESRI ArcGIS), a maintenance system (likely Maximo or equivalent CMMS), SCADA on grid assets, and consumes external weather feeds — but these are siloed
- **Why:** This is standard for a US utility of SGW's scale. The brief explicitly calls out fragmentation across "GIS systems, maintenance platforms, weather feeds, and field operations tools."
- **If wrong:** If SGW is more mature than assumed (a data lake already exists), MVP scope shrinks and integration effort in the roadmap should shorten. If less mature, foundational data-engineering work has to precede any AI capability — the roadmap becomes 12–18 months not 6–9.

### A3. SGW's reference footprint is SC / GA / NC (coastal + inland)
- **Why:** The brief describes coastal + inland regions exposed to all four hazards. SC/GA/NC exemplifies all four in one contiguous footprint (Atlantic hurricane coast + Piedmont/Appalachian inland flood, heat and wildfire risk) with excellent NOAA data coverage (Digital Coast, NHC SLOSH, CO-OPS gauges including Charleston Harbor 8665530).
- **If wrong:** The platform extends to other US regions using the same adapters with region-specific hazard-layer fixtures. The workflow, model portfolio and UI are unchanged.

### A4. NOAA is the reference federal data stack; the ingestion layer's adapter pattern isolates provider choice for non-US deployment
- **Why:** For a US utility, NOAA is the authoritative, free, no-key public data source spanning weather, hurricane, surge, streamflow, coastal exposure and historical events. Building on NOAA is what a real utility would do and signals domain awareness. The adapter pattern (six adapters — see [05_architecture.md](05_architecture.md)) means non-US deployment (Met Office, ECMWF, JMA, etc.) swaps adapter implementations without touching risk scoring, optimisation or UI.
- **If wrong:** No material impact — the adapter interface is exactly the abstraction that makes provider choice a config concern.

## B. Data availability and quality

### B1. External hazard/weather data draws on the full NOAA stack, not just `api.weather.gov`
- **MVP sources:** NWS API (alerts, forecasts, station obs) + NHC GIS (hurricane cone + SLOSH MOM surge) + NOS CO-OPS (real tide-gauge observations) + Digital Coast (coastal flood exposure) + SPC/CPC outlooks (severe-storm + heat) + NCEI Storm Events (historical baseline).
- **Phase 2 additions:** NWM (streamflow), NCEP HRRR/GFS (gridded numerical weather), nowCOAST (OGC backup), NGS post-event imagery, NIFC/InciWeb (wildfire perimeters — non-NOAA).
- **Why:** NOAA products are free, authoritative and standard practice for US utilities. Naming the specific NOAA sub-agencies signals domain awareness that a mixed-audience reviewer will value.
- **If wrong:** If SGW has an existing commercial contract (Tomorrow.io, DTN), integrate via a commercial-adapter behind the same interface (see A4). No architectural change.
- **Full source registry:** [07_external_data_sources.md](07_external_data_sources.md).

### B2. Asset data can be aligned to the IEC 61970 Common Information Model (CIM) for grid assets and a water-utility equivalent (or a custom schema) for water
- **Why:** CIM is the North American utility standard for grid interoperability. Assuming CIM signals technical fluency and makes integration effort estimable.
- **If wrong:** If SGW uses a proprietary schema, add a translation layer — cost is real but bounded.

### B3. Historical failure data is sparse for rare events (Category 3+ hurricanes, 100-year floods)
- **Why:** Even at 8M residents, SGW may see <5 major storm seasons of usable data. This is a known problem for climate-risk ML.
- **Mitigations designed into the PRD:** transfer learning from other utilities where possible, physics-informed features (elevation, flood zones, vegetation encroachment) not just historical patterns, uncertainty quantification surfaced in the UI, and human-in-the-loop overrides.

### B4. Data freshness — SCADA telemetry updates every 5–60 seconds; asset metadata refresh daily; weather forecasts refresh every 1–6 hours depending on product
- **Why:** Consistent with real utility system architectures.

## C. Technical architecture

### C1. Hybrid deployment — AWS (GovCloud for CIP-scoped workloads) for training, batch inference, storage; on-prem edge appliances at NOC for real-time inference and continuity during outages
- **Why:** A utility whose *product* is resilience cannot have a decision-support platform that goes down when the internet does. FERC/NERC CIP compliance also pushes some workloads on-prem. Cloud-only would fail credibility.
- **If wrong:** If SGW is cloud-native and has hardened redundant WAN, this simplifies significantly.

### C2. AI model portfolio (not a single model):
- **Forecasting:** gradient-boosted models (LightGBM/XGBoost) + probabilistic time-series (e.g., Prophet or a Temporal Fusion Transformer) for asset-level demand and stress forecasting
- **Anomaly detection:** unsupervised (Isolation Forest, autoencoder reconstruction error) on SCADA streams, per-asset baselines
- **Risk scoring:** supervised regression (LightGBM v2) blending forecast features, asset attributes, geospatial hazard layers, and (in production) historical failure joins. Real probability calibration is Phase 2 — needs real failure history the fictional utility can't provide.
- **Optimisation:** MILP or heuristic (e.g., OR-Tools) for crew pre-positioning under coverage + travel-time constraints
- **LLM layer:** structured-output LLM for explanation generation ("why is Asset #12345 flagged?"), operator Q&A over documents, and post-event report drafting — never the source of the risk score itself
- **Why:** The brief explicitly asks for AI beyond LLMs. This is a defensible portfolio that shows I know when each family is right.

### C3. LLM choice for prototype: an open-weights or hosted model with structured-output support (e.g., Claude Sonnet, GPT-4-class model). Locally hosted alternative viable for production if data residency requires it.
- **Why:** Prototype needs to demonstrate, not ship. Production model choice will depend on data-classification review and SGW's cloud posture.

## D. Governance, security and human-in-the-loop

### D1. All AI recommendations are advisory — a human in the appropriate role must accept or override before action (crew dispatch, asset shutdown, public communication)
- **Why:** Critical infrastructure. Regulatory context (NERC CIP, state PUCs, potentially insurance obligations). Also the assessment explicitly calls out human oversight.
- **How it shows up in the product:** every AI-generated recommendation has an accept/override/comment path, an auditable log, and a confidence indicator.

### D2. Model drift and calibration must be monitored continuously
- **Why:** Climate patterns are non-stationary. A model trained on 2020–2025 data will drift as base rates of severe weather change.
- **How:** monitoring dashboard for calibration curves, feature drift alerts, scheduled re-training cadence stated in the PRD.

### D3. Compliance frame: NERC CIP (grid), state PUC oversight, and general SOC 2 / FedRAMP-adjacent controls for the cloud components
- **Why:** These are the standard obligations for a US grid operator.

## E. MVP scope boundaries

### E1. MVP is the pre-event and early-onset phase of the Multi-Hazard Readiness & Response workflow — covering hurricane, flood, heatwave and wildfire, across coastal *and* inland regions
- **In scope:** ingest fragmented multi-source data (GIS, CMMS, SCADA, weather alerts, field reports) → produce hazard-conditional per-asset risk scoring with contributing factors → surface cascading impacts via dependency graph → recommend preventative work orders + crew pre-positioning → operator review UI with accept/override and audit log
- **Out of scope for MVP (Phase 2/3 in roadmap):** live incident triage during event, post-event damage assessment (CV-heavy), cross-domain water optimisation, resident-facing communication, work-order execution tracking, hazard-onset classifier from multi-source anomalies
- **Why multi-hazard now:** the brief explicitly names four hazards and both coastal/inland exposure. A storm-only MVP would materially under-serve the case. Different hazards drive different asset risks, and a platform that reasons *conditional on hazard type* is a much stronger technical story than four one-off models.
- **Why pre-event / early-onset phase:** longest lead time, highest decision leverage, tractable data. Downstream phases (during-event, post-event) are natural extensions built on the same platform chassis.

### E2. Prototype uses synthetic/mocked data based on plausible utility assumptions; no real SGW data exists (SGW is fictional)
- **Why:** Explicitly allowed by the brief. Synthetic data must be plausible enough that operational reviewers don't dismiss it.

### E3. The mock dataset is fragmented on purpose — multiple formats (GeoJSON, CSV, JSON), different asset identifiers per source system, sensor quality flags, free-text field notes — and requires an ingestion + ID-resolution layer before AI can be applied
- **Why:** SGW's stated problem is data fragmentation. Presenting a pre-joined clean dataset would hide the exact integration challenge the platform is designed to solve. Fragmentation-by-design also lets the prototype demonstrate technical maturity (schema handling, ID crosswalks, data-quality flags, freshness discipline) before the AI story even starts.
- **If wrong:** if SGW's data is already unified in a lake/warehouse, the ingestion layer shrinks and the roadmap accelerates — the AI capabilities and workflow remain the same. See [06_data_model.md](06_data_model.md).

### E4. External hazard classification (hurricane, flood, heatwave, wildfire type + severity) is provided by upstream authoritative sources — NWS, NHC, USGS, state agencies — not invented by SGW's platform
- **Why:** Reinventing NOAA's classifiers would be worse and slower than integrating them. The AI value-add is **hazard-conditional asset-risk scoring** given the hazard type — not classifying the hazard itself from raw weather.
- **If wrong:** a multi-source hazard-onset classifier is designed into Phase 2 (complementing external alerts, catching emerging events before upstream classification). This is a stretch feature, not the MVP.

---

## Meta-assumption: what I would change first with more information

If I had a 15-minute conversation with an SGW ops director before starting, I would prioritise questions in this order:
1. What is your single biggest operational pain during a major storm — is it *knowing what's happening*, *deciding what to do*, or *executing the response*? (This shifts the MVP phase.)
2. What decision-support tools already exist that operators trust? (Anchors the change-management story.)
3. Where is your data most mature and most immature? (Directly reshapes the roadmap.)
