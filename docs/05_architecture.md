# Architecture — placeholder

**Status:** Draft after PRD (Day 2–3), refined after prototype exists (Day 5)

## Placeholder structure

### System context
*Actors: NOC operator, Emergency Coordinator, Field Supervisor, Maintenance Planner. External systems: GIS (ESRI-shaped), CMMS (Maximo-shaped), SCADA/IoT, weather providers (NOAA/NWS/NHC/USGS + optional commercial), CV pipeline (Phase 3).*

### Container view
*Multi-source ingestion → ID resolution / canonicalisation → **PostgreSQL 16 + PostGIS 3.4** (canonical operational store) → feature builder (materialised view) → model serving (hazard-conditional risk + Prophet forecasting + Prophet-residual anomaly + OR-Tools optimiser + networkx graph + Louvain) → LLM explanation layer → FastAPI → React UI → audit log (Postgres append-only + hash chain) → monitoring (Prometheus + Grafana, optional).*

### Persistence layer — PostgreSQL 16 + PostGIS 3.4
- **Why Postgres/PostGIS specifically:** industry standard for utility geospatial workloads. Real utility operational stores are on PostGIS (or equivalent Oracle Spatial); SQLite is not credible at SGW scale.
- **Spatial:** `Geometry(POINT|LINE|POLYGON, 4326)` columns with GiST spatial indexes on assets, service areas, hazard zones. Enables sub-second spatial joins (which assets fall within a surge polygon).
- **JSONB:** for LLM outputs, adapter metadata, alert payloads — semi-structured without a rigid schema.
- **Declarative partitioning:** `sensor_readings` partitioned by month for scale-demo credibility.
- **Materialised view:** `operational_risk_snapshot` — the curated §9 view from the data model, refreshed on demand or on schedule.
- **Append-only tables:** `audit_log`, `predictions`, `operator_decisions` — UPDATE/DELETE blocked by trigger; hash chain on `audit_log` for tamper evidence.
- **Migrations:** every schema change through Alembic; no hand-edits.

### Ingestion & ID resolution (first-class concern)
The mock dataset is fragmented on purpose — see [06_data_model.md](06_data_model.md). External hazard/weather data is drawn from the full NOAA stack — see [07_external_data_sources.md](07_external_data_sources.md). The ingestion layer must:
- Handle **multiple formats** per source (GeoJSON, CSV, JSON, SCADA stream, GRIB2, NetCDF, WMS)
- **Resolve identifiers** via the `asset_id_crosswalk.csv` (GIS ID ↔ Maintenance ID ↔ SCADA ID ↔ Field-Ops ID → canonical `asset_id`)
- Honour **sensor quality flags** (Valid / Warning / Stale / Missing / Outlier / Sensor fault) — downstream scoring must know which readings to trust
- **Reproject to WGS84 at ingest** — Digital Coast and other geospatial sources ship in various projections (Web Mercator, state plane, Albers)
- Preserve **freshness metadata** per record so operators see how stale each piece of evidence is
- Support **replay from historical snapshots** for training and post-event review

This layer is the platform's operational foundation. It's also — even before AI — the first place SGW would see immediate ROI, because it collapses the "which system is right?" problem operators face today.

### Hazard Data adapter family
External hazard/weather integration decomposes into **six adapters**, isolating provider choice for non-US deployment (Met Office / ECMWF / JMA / others):

| Adapter | Source(s) — MVP | Extends to (Phase 2) | Purpose |
|---|---|---|---|
| **AlertAdapter** | NWS `/alerts/active` | State/local emergency-management feeds | Classified hazard alerts → drives workflow trigger |
| **ForecastAdapter** | NWS `/gridpoints/.../forecast` | NCEP HRRR (3 km hourly, GRIB2 on S3), GFS | Gridded numerical weather features for the risk model |
| **ObservationAdapter** | NWS stations + NOS CO-OPS tide gauges (Charleston Harbor 8665530 anchor) | Additional gauge networks, satellite obs | Observed weather + water levels |
| **HazardLayerAdapter** | Digital Coast (coastal flood exposure), NHC SLOSH MOM (surge), SPC/CPC outlooks, FEMA flood zones | nowCOAST OGC services (backup/cross-check) | Static + updating hazard polygons |
| **TrackAdapter** (hurricane-specific) | NHC forecast cone (shapefile per advisory) | — | Storm-track geometry during active advisories |
| **StreamflowAdapter** (Phase 2) | — | National Water Model (aggregated reach-level via water.noaa.gov) | Inland flood streamflow forecasting |

Each hazard type composes the same adapters differently — hurricane needs Track + HazardLayer(SLOSH) + Forecast + Observation; heatwave needs HazardLayer(CPC) + Forecast + Observation; wildfire needs HazardLayer(SPC fire-weather) + Alert(NWS Red Flag) + (Phase 2) NIFC perimeters. This maps cleanly onto the AI capability portfolio in [02_mvp_workflow.md](02_mvp_workflow.md).

### AWS S3 access pattern
NOAA Open Data lives on anonymous public S3 (`noaa-nwm-pds`, `noaa-hrrr-bdp-pds`). Boto3 requires `Config(signature_version=UNSIGNED)`, or use HTTPS S3 endpoints directly. Different from typical REST fetch — worth calling out in the ingestion adapter README so nobody wastes time on IAM.

### Component view (per container)
*Detail once prototype exists so the diagram matches what actually runs.*

### Deployment view
*Hybrid — cloud for training, batch inference, feature store, storage; on-prem edge appliance at NOC for real-time inference, dashboard, audit log write-through.*

### Sequence: pre-storm risk update
1. Weather ingest cron fires (every 1h during watch window)
2. Feature builder joins forecast + asset + hazard layer + history
3. Risk model batch scores all in-region assets
4. Optimiser produces crew pre-positioning plan
5. LLM generates per-asset explanations for top-N flagged
6. Dashboard refreshes; operator receives push notification if new critical flags
7. Operator accept/override → audit log → downstream CMMS work-order creation

### Sequence: operator drill-down
*Operator clicks asset → API fetches score, features, historical context, model confidence, LLM explanation, related work orders → renders panel with accept/override affordance.*

### Non-functional
- Availability: 99.9% NOC-side during declared storm window (edge appliance keeps working if cloud is unreachable)
- Latency: dashboard refresh < 5s; risk score refresh < 60s from new weather data
- Auditability: every recommendation + every operator action is logged, immutable, exportable

### Risks and open architecture questions
- Feature store choice — do we need one, or is a scheduled batch pipeline enough for MVP? (MVP: batch is enough.)
- Model serving stack — cloud-managed vs. self-hosted (defer decision to production planning)
- LLM data-residency — decision depends on SGW's data-classification review
