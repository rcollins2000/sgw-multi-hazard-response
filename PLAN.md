# PLAN.md — Autonomous execution plan for the SGW MVP prototype

**Status doc:** [.claude/status.md](.claude/status.md) (updated by the `dev-tracker` subagent)
**Companion:** [CLAUDE.md](CLAUDE.md) — must-read for principles + stack + conventions
**Guiding docs:** [docs/04_prd.md](docs/04_prd.md), [docs/02_mvp_workflow.md](docs/02_mvp_workflow.md), [docs/07_data_model.md](docs/07_data_model.md), [docs/08_external_data_sources.md](docs/08_external_data_sources.md)

## How to use this plan

- Execute phases **in order**. A phase's gate must pass before starting the next.
- Each phase lists: **Objective → Deliverables → Steps → Tests → Gate**.
- **Gate** = the exact commands + assertions that prove the phase is done. Automated.
- Do not partially finish a phase. If blocked, write [.claude/blocked.md](.claude/blocked.md) and stop.
- Log any material decision (framework, scope, model choice) in [docs/00_working_notes.md](docs/00_working_notes.md).
- After each phase: invoke `dev-tracker` to update [.claude/status.md](.claude/status.md); after user-visible features: invoke `demo-scribe`.

## Build decisions (pre-made — no user approval needed)

| Area | Choice | Reason |
|---|---|---|
| Python version | 3.12 | Modern, all deps compatible, good typing story |
| Python env / deps | `uv` | Fast, modern, lockfile-based |
| API framework | FastAPI + Pydantic v2 | Standard, async, schema-first |
| Logging | structlog (JSON) | Machine-readable, request-context binding |
| Metrics | prometheus-client | Standard, /metrics endpoint |
| Operational data store | **PostgreSQL 16 + PostGIS 3.4** | Industry standard for utility geospatial workloads; matches real SGW-scale deployment; enables spatial queries + JSONB + partitioning + materialised views |
| ORM + migrations | **SQLAlchemy 2.x (async) + Alembic + asyncpg** | Standard modern Python DB stack; type-safe; migrations trackable |
| Audit store | **Postgres append-only table with UPDATE/DELETE trigger blocks + SHA-256 hash chain** | Same operational store, tamper-evident, no separate infra to manage |
| GBM | LightGBM | Faster than XGBoost on tabular, same interface family |
| Forecasting | Prophet | Direct prior work — Module 3.06 |
| Anomaly | Prophet-residual (Option B) | Re-uses forecast layer, defensible |
| Optimisation | OR-Tools VRP + Guided Local Search | Direct prior work — Module 7.06 |
| Graph | networkx + python-louvain | Direct prior work — Module 7.05 |
| Frontend framework | React 18 + Vite + TypeScript strict | Modern, fast dev, common |
| UI primitives | Tailwind CSS + shadcn/ui | Accessible defaults, tweakable later |
| Maps | react-leaflet + MapLibre tiles | Open-source, works with GeoJSON |
| Charts | Recharts | Simple, React-native |
| Server state | TanStack Query | Standard for API state |
| Client state | Zustand | Simpler than Redux for MVP |
| E2E tests | Playwright | Cross-browser, deterministic |
| Unit tests (JS) | Vitest + React Testing Library | Vite-native |
| Unit tests (PY) | pytest + pytest-asyncio | Standard |
| LLM provider (primary) | **Ollama Cloud** (`ollama` SDK, model `gpt-oss:120b`) | Cheaper for iteration; open-weights model; user has an API key; smoke-tested in Phase 0 |
| LLM provider (fallback) | OpenAI v1+ (`gpt-5.6`) | Swappable via `LLM_PROVIDER` env var |
| Structured outputs | Pydantic → JSON schema → passed in BOTH `format=` AND system prompt; validated + retried once on failure | gpt-oss:120b will invent its own schema if the schema is only in `format=`. Verified in Phase 0 smoke. |
| Dev orchestration | docker-compose + Makefile | Local dev only, no cloud infra |

## Repository target structure

```
technical_challenge/
├── CLAUDE.md
├── PLAN.md
├── README.md
├── Makefile
├── .env.example
├── .gitignore
├── docker-compose.yml
├── docs/                          # existing planning docs
├── plan/
│   └── phase_notes/               # per-phase implementation notes
├── .claude/
│   ├── agents/                    # subagent definitions
│   ├── status.md                  # dev-tracker output
│   └── blocked.md                 # created only when blocked
├── data/
│   ├── raw/                       # NOAA + internal source fixtures
│   ├── reference/
│   ├── curated/
│   └── generators/                # mock data scripts
├── backend/
│   ├── pyproject.toml
│   ├── alembic/                   # migrations (versioned)
│   │   ├── env.py
│   │   └── versions/
│   ├── alembic.ini
│   ├── src/sgw_platform/
│   │   ├── db/                    # SQLAlchemy models, session, base
│   │   │   ├── base.py
│   │   │   ├── session.py
│   │   │   └── models/            # one file per aggregate
│   │   ├── adapters/              # NOAA + internal adapters
│   │   ├── ingestion/             # id resolution, quality flags → writes to Postgres
│   │   ├── features/              # feature builder → materialised view
│   │   ├── models/                # risk, forecast, anomaly
│   │   ├── optimisation/          # OR-Tools
│   │   ├── graph/                 # networkx + Louvain
│   │   ├── explain/               # LLM copilot
│   │   ├── governance/            # fairness, drift, calibration
│   │   ├── audit/                 # append-only writer + hash chain verifier
│   │   ├── observability/         # logging, metrics
│   │   ├── settings.py
│   │   └── api/                   # FastAPI endpoints
│   ├── tests/
│   │   ├── unit/
│   │   ├── integration/           # uses testcontainers-postgres
│   │   ├── contract/              # NOAA API schema conformance
│   │   └── evals/                 # model evaluation suite
│   └── scripts/                   # NOAA fixture pullers, seed loaders
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/                   # TanStack Query hooks
│   │   ├── lib/
│   │   ├── stores/                # Zustand
│   │   └── types/                 # Zod schemas + inferred types
│   └── tests/
├── demo/
│   ├── walkthrough.md             # populated by demo-scribe
│   ├── script.md                  # video narration
│   └── scenarios/                 # Debby, Idalia scenario runners
└── infra/
    └── observability/             # optional Prometheus/Grafana/Loki
```

---

## Phase 0 — Scaffold + tooling  *(est. 3 h)*

### Objective
A clean, buildable repo skeleton with backend, frontend, Postgres+PostGIS via docker, migrations wired, and CI-grade tooling. Nothing yet does useful work, but everything runs.

### Deliverables
- `backend/pyproject.toml` with `uv`-managed deps + ruff + mypy + pytest configs
- `backend/alembic.ini` + `backend/alembic/env.py` configured for async SQLAlchemy
- Initial Alembic migration creates PostGIS extension + `sgw` schema (empty; tables in Phase 1)
- `backend/src/sgw_platform/db/base.py` — `DeclarativeBase`, common columns, type annotations
- `backend/src/sgw_platform/db/session.py` — async engine + session factory
- `frontend/package.json` with Vite + React + TS + Tailwind + shadcn/ui + react-leaflet + TanStack Query + Zustand + Vitest + Playwright
- `docker-compose.yml` with postgres + backend + frontend services + shared network + health checks
- `infra/postgres/init.sql` — creates PostGIS extension on first boot
- `.env.example` with `OPENAI_API_KEY`, `DATABASE_URL`, `POSTGRES_*`, `LOG_LEVEL`, `NOAA_CACHE_DIR`
- `Makefile` with `install`, `dev`, `test`, `lint`, `db-migrate`, `db-reset`, `db-shell`, `demo`, `clean`
- Backend `GET /health` returning `{"status": "ok", "version": "...", "db": "connected"}`
- Backend `GET /ready` — checks Postgres + PostGIS extension present
- Frontend renders a placeholder page reading `<h1>SGW Platform</h1>`

### Steps
1. Initialise `backend/` with `uv init` and add all deps from `CLAUDE.md` stack (including sqlalchemy[asyncio], alembic, asyncpg, geoalchemy2)
2. Configure `ruff` (line length 100, all rules on), `mypy` (strict), `pytest` (asyncio auto)
3. Create `backend/src/sgw_platform/settings.py` using `pydantic-settings` (reads `DATABASE_URL`, `OPENAI_*`, etc.)
4. Create `backend/src/sgw_platform/db/{base,session}.py`
5. `uv run alembic init alembic` and configure `env.py` for async engine using settings module
6. Write initial migration: `CREATE EXTENSION IF NOT EXISTS postgis;`
7. Create `backend/src/sgw_platform/api/main.py` with FastAPI + `/health` + `/ready`
8. Create `backend/src/sgw_platform/observability/logging.py` with structlog JSON config
9. Initialise `frontend/` with `pnpm create vite@latest frontend --template react-ts`
10. Add Tailwind + shadcn/ui + react-leaflet + TanStack Query + Zustand + Zod
11. Configure `tsconfig.json` for strict mode
12. Write `docker-compose.yml`: postgres (postgis/postgis:16-3.4 with health check), backend (depends_on postgres healthy), frontend (depends_on backend)
13. Write `infra/postgres/init.sql`
14. Write `Makefile` targets

### Tests
- `pytest backend/tests` runs (empty pass)
- `pnpm test` runs in frontend (empty pass)
- `ruff check backend/` passes
- `mypy backend/src` passes
- `docker-compose up -d postgres` brings postgres healthy
- `make db-migrate` succeeds; PostGIS extension present (`SELECT postgis_version()` returns non-null)
- `docker-compose up` brings all three services healthy
- `curl localhost:8000/health` returns 200 with `db: "connected"`
- `curl localhost:8000/ready` returns 200 with PostGIS confirmed
- `curl localhost:5173` returns HTML with the placeholder

### Gate
```bash
make lint && make typecheck && make test && docker-compose up -d && make db-migrate && curl -f localhost:8000/ready && curl -f localhost:5173
```
All exit 0.

---

## Phase 1 — Mock data generation + Postgres schema  *(est. 5 h)*

### Objective
A fragmented-on-purpose synthetic dataset matching [docs/07_data_model.md](docs/07_data_model.md), materialised both as raw files (representing the source systems) *and* as canonical Postgres tables (the platform's operational store). Enough volume + variety to run every AI capability. IDs deliberately inconsistent across source systems so ingestion has real work to do.

### Postgres schema (added in this phase — Alembic migration)
- `assets` — PostGIS `Geometry(POINT|LINE|POLYGON, 4326)` column, attributes, condition, criticality
- `service_areas` — polygon geometry, population, priority facilities
- `hazard_zones` — polygon geometry, hazard type, severity band, source metadata
- `work_orders`, `inspection_history`, `crews`, `crew_status`, `field_reports`, `incidents`, `outages`
- `sensor_readings` — **partitioned by month** (declarative partitioning), with quality flags
- `asset_dependencies` — directed edge list with dependency_type and consequence_if_lost
- `asset_id_crosswalk` — canonical → per-source-system IDs
- `regions`, `historical_events`
- `weather_observations`, `weather_forecasts`, `weather_alerts` (JSONB payload column), `hurricane_tracks`
- `audit_log` — append-only, hash chain (previous_hash, current_hash), UPDATE/DELETE blocked by trigger
- `model_versions` — registry of every trained model artefact
- `predictions` — append-only, per-asset per-timestamp risk scores + features_hash + model_version
- `operator_decisions` — append-only, links to prediction id + user + action + comment
- Materialised view `operational_risk_snapshot` — the curated §9 view from the data model

### Deliverables
**Raw file generators** (represent the fragmented source systems):
- `data/generators/generate_assets.py` → `data/raw/gis/assets.geojson` (150–300 assets across SC/GA/NC, WGS84, plausible urban+rural distribution)
- `data/generators/generate_service_areas.py` → `data/raw/gis/service_areas.geojson`
- `data/generators/generate_hazard_zones.py` → `data/raw/gis/hazard_zones.geojson` *(placeholder polygons replaced by real NOAA fixtures in Phase 2)*
- `data/generators/generate_maintenance.py` → `data/raw/maintenance/{work_orders,inspection_history}.csv`
- `data/generators/generate_scada.py` → `data/raw/operations/sensor_readings.csv` (20k–50k rows, realistic quality-flag distribution)
- `data/generators/generate_field_ops.py` → `data/raw/field_operations/{crews,crew_status,field_reports}.csv`
- `data/generators/generate_incidents.py` → `data/raw/operations/{incidents,outages}.csv`
- `data/reference/asset_id_crosswalk.csv` — deliberately inconsistent IDs
- `data/reference/asset_dependencies.csv` — dependency graph edges
- `data/reference/regions.csv`
- `data/generators/run_all.py` — orchestrator, idempotent, seeded for reproducibility

**Postgres schema + seed** (Alembic + loader):
- Alembic migration `002_operational_schema.py` — creates all tables above with PostGIS geometry columns, partitioned `sensor_readings`, JSONB payload columns, append-only triggers, `operational_risk_snapshot` materialised view
- `backend/scripts/seed_from_raw.py` — reads `data/raw/**` + `data/reference/**` and loads into Postgres (idempotent via ON CONFLICT); preserves quality flags + source lineage
- `Makefile` target `make db-seed` runs the loader

### Steps
1. Per data-model §1–8, implement each generator with `numpy` seed + Pydantic model validation
2. Include seasonal patterns in SCADA readings so Prophet has something to model
3. Inject anomalies at known timestamps for anomaly-detection evals
4. Build asset-dependency graph with realistic topology (~200–500 edges, some deep chains, some communities)
5. Populate crosswalk with GIS/Maintenance/SCADA/Field-Ops variant IDs per asset
6. Add `Makefile` target `make data-mock` that runs `run_all.py`

### Tests (`backend/tests/unit/test_mock_data.py` + `tests/integration/test_seed.py`)
- Schema validation via Pydantic — every raw file loads into typed models
- Referential integrity — every `asset_id` in work orders / SCADA / dependencies exists in `assets.geojson`; every crosswalk row resolves
- Volume ranges match spec (assets 150–300, SCADA 20k–50k, etc.)
- Quality-flag distribution realistic — 85–95% Valid, remainder distributed across Warning / Stale / Missing / Outlier / Sensor fault
- No orphan sensors, no orphan dependencies
- Seasonality present in SCADA (autocorrelation lag-24 > 0.3 for cyclic sensors)
- Injected anomalies present at expected timestamps (marker column in a hidden truth file)
- **Postgres seed integration** (uses testcontainers-postgres) — after `make db-seed`:
  - Row counts match raw file volumes
  - PostGIS spatial index present on `assets.geom`, `service_areas.geom`, `hazard_zones.geom`
  - `sensor_readings` partitions created for the covered date range
  - Append-only trigger blocks a test UPDATE on `audit_log`
  - `REFRESH MATERIALIZED VIEW operational_risk_snapshot` succeeds
  - Spatial query returns expected asset count within a test polygon

### Gate
```bash
make data-mock && make db-migrate && make db-seed && pytest backend/tests/unit/test_mock_data.py backend/tests/integration/test_seed.py -v
```
All green.

---

## Phase 2 — NOAA integrations + fixture pull  *(est. 6 h)*

### Objective
Six-adapter Hazard Data family fully implemented. Real NOAA fixtures pulled and clipped for Debby (primary) + Idalia (validation).

### Deliverables

**Adapters** (`backend/src/sgw_platform/adapters/`)
- `alerts.py` — `AlertAdapter` (NWS `/alerts/active`)
- `forecast.py` — `ForecastAdapter` (NWS `/gridpoints`)
- `observations.py` — `ObservationAdapter` (NWS stations + NOS CO-OPS)
- `hazard_layer.py` — `HazardLayerAdapter` (Digital Coast, NHC SLOSH, SPC, CPC)
- `track.py` — `TrackAdapter` (NHC cone shapefile parser)
- `streamflow.py` — `StreamflowAdapter` (NWM stub — Phase 2 marker, not fetched)

**Fixture scripts** (`backend/scripts/`)
- `pull_coops_charleston.py` — CO-OPS gauge 8665530, windows for Debby (2024-08-03 → 2024-08-07) + Idalia (2023-08-29 → 2023-09-02)
- `clip_digital_coast.py` — flood-exposure clipped to SC/GA/NC bbox, reprojected to WGS84
- `clip_nhc_slosh.py` — SLOSH MOM clipped, reprojected
- `pull_nhc_tracks.py` — Debby + Idalia forecast cones from NHC archive
- `pull_spc_cpc.py` — one heatwave / severe-storm outlook fixture
- `pull_ncei_events.py` — Storm Events filtered to SE US 2015–2024 → `data/reference/historical_events.csv`

**Fixtures produced**
- `data/raw/weather/observations.csv` (real Charleston Harbor data)
- `data/raw/gis/hazard_zones.geojson` (replaces Phase 1 placeholders)
- `data/raw/weather/hurricane_track_debby.geojson`
- `data/raw/weather/hurricane_track_idalia.geojson`
- `data/reference/historical_events.csv`

### Steps
1. Implement each adapter with `httpx.AsyncClient`, retry policy, contract Pydantic model
2. Anonymous S3 access for NWM (config only, don't fetch in MVP — leave adapter as stub)
3. CRS reprojection via `pyproj` in the ingestion boundary
4. Fixture scripts idempotent (skip if file present) unless `--force`
5. All fixture files under `data/raw/` are ignored by git (per `.gitignore`) except the small clipped GeoJSON

### Tests

**Contract** (`backend/tests/contract/`)
- Recorded VCR-style JSON snapshots per adapter — schema regression tests

**Integration** (`backend/tests/integration/test_adapters.py`)
- Each adapter transforms source → canonical Pydantic model
- Charleston Harbor observations have expected schema + non-empty windows
- Hazard-zone GeoJSON is WGS84 + has non-empty polygon features
- NHC cone GeoJSON parses + covers expected date ranges

### Gate
```bash
make fixtures && pytest backend/tests/contract backend/tests/integration -v
```
All green + fixture files present in `data/raw/`.

---

## Phase 3 — Ingestion + ID resolution + feature builder  *(est. 4 h)*

### Objective
Fragmented sources join into a canonical operational snapshot in Postgres, suitable for AI capability inputs. Ingestion is the platform's data-engineering foundation — this is where "which system is right?" gets resolved.

### Deliverables
- `backend/src/sgw_platform/ingestion/id_resolver.py` — canonical `asset_id` from any source ID (queries `asset_id_crosswalk`)
- `backend/src/sgw_platform/ingestion/loaders.py` — multi-format loaders (GeoJSON, CSV, JSON) writing to typed SQLAlchemy models
- `backend/src/sgw_platform/ingestion/quality.py` — quality-flag propagation into DB rows
- `backend/src/sgw_platform/ingestion/freshness.py` — freshness metadata columns on every ingest row
- `backend/src/sgw_platform/ingestion/pipeline.py` — end-to-end orchestrator: source → adapter → canonicalise → write with lineage
- `backend/src/sgw_platform/features/builder.py` — builds feature frames per (asset, timestamp) via SQL joins across GIS + hazard + weather + history; refreshes `operational_risk_snapshot` materialised view
- CLI: `python -m sgw_platform.features.builder` refreshes the materialised view

### Steps
1. Resolver reads `asset_id_crosswalk.csv` at init; O(1) lookup thereafter
2. Loaders return typed Pydantic collections
3. Quality-flag propagation: any downstream aggregation must respect the input flag (never silently use Stale as if Valid)
4. Feature builder joins on canonical asset_id, spatial-joins hazard polygons via geopandas, adds forecast + observation features per asset
5. Builder produces snapshot compatible with data-model §9

### Tests (`backend/tests/unit/test_ingestion.py` + `tests/integration/test_features_pipeline.py`)
- Resolver handles known IDs from every source system
- Resolver raises on unknown ID (rather than silent fallback)
- Loaders round-trip through Pydantic + SQLAlchemy without loss
- Ingestion writes include source_system, source_id, ingested_at, quality_flag (lineage)
- Feature builder output schema matches data-model §9
- **PostGIS spatial join** produces correct hazard-polygon membership for a known test asset
- Quality flags surface in output (Stale readings marked in derived features)
- Materialised view refresh completes in < 2 s on the seed dataset

### Gate
```bash
pytest backend/tests/unit/test_ingestion.py backend/tests/integration/test_features_pipeline.py -v
```

---

## Phase 4 — AI models  *(est. 8 h)*

### Objective
Every capability in the [locked portfolio](docs/02_mvp_workflow.md) implemented, tested, and evaluated on the mock dataset.

### Deliverables

**Risk scoring** (`backend/src/sgw_platform/models/risk.py`)
- LightGBM classifier
- Isotonic calibration
- Random Forest baseline
- Feature-importance extraction
- Trained model artefact (not committed; regenerable)

**Forecasting** (`backend/src/sgw_platform/models/forecast.py`)
- Prophet per sensor / metric with weather features as exogenous regressors
- Uncertainty band extraction
- Per-asset model persistence

**Anomaly detection** (`backend/src/sgw_platform/models/anomaly.py`)
- Prophet-residual detector
- Anomaly score = normalised residual magnitude vs. uncertainty band width

**Optimisation** (`backend/src/sgw_platform/optimisation/vrp.py`)
- OR-Tools VRP with Guided Local Search
- Constraints: crew capability, travel time (Haversine), shift hours, regional coverage
- Greedy baseline for comparison

**Graph** (`backend/src/sgw_platform/graph/dependency.py`, `blast_radius.py`)
- BFS from any flagged asset
- Louvain community detection with modularity extraction
- Blast-radius cluster ID assignment per asset

**Governance** (`backend/src/sgw_platform/governance/fairness.py`)
- Demographic-parity + equal-opportunity gap metrics across region / domain / demographics
- Calibration curves per region
- Drift detection (feature-distribution + prediction-distribution)

### Steps
1. Feature engineering pipeline in `features/builder.py` outputs training-ready frames
2. Risk model trained with LightGBM defaults, then a small hyperparameter search
3. Prophet fit per sensor once at build time; artefacts cached
4. VRP formulation: minimise weighted response time subject to coverage
5. Dependency graph loaded once at API startup, cached
6. Louvain re-runs on dependency-graph updates
7. Fairness metrics computed on held-out test set stratified by region / domain

### Evals (`backend/tests/evals/`)
- **Risk model** — calibration: Brier score < 0.20; reliability diagram bins within tolerance; per-region calibration gaps below threshold
- **Forecast** — MAPE per sensor < 25%; coverage of 80% prediction interval within [0.70, 0.90]
- **Anomaly** — precision + recall on injected anomalies (from Phase 1) both > 0.60
- **Optimisation** — VRP satisfies all constraints; total weighted response time improves ≥ 15% over greedy baseline
- **Graph** — BFS from a known bottleneck reaches known-cascaded assets in expected order
- **Louvain** — modularity > 0.30 on the dependency graph
- **Fairness** — computed gaps produced without error; thresholded alerts fire correctly on synthetic biased data

### Gate
```bash
make train && pytest backend/tests/evals -v
```
All evals within thresholds.

---

## Phase 5 — LLM copilot layer  *(est. 4 h)*

### Objective
Provider-swappable LLM (Ollama Cloud default, OpenAI fallback) for explanation generation with structured outputs, evidence-ID citation, and cost + drift monitoring.

### Deliverables
- `backend/src/sgw_platform/explain/schemas.py` — Pydantic models for explanation, briefing, Q&A response
- `backend/src/sgw_platform/explain/provider.py` — protocol + factory (`OllamaProvider` + `OpenAIProvider`), selected via `LLM_PROVIDER`
- `backend/src/sgw_platform/explain/client.py` — high-level `LLMClient.structured(schema, messages, retries=1)`
- `backend/src/sgw_platform/explain/retrieval.py` — evidence retrieval (fetches source records by ID for citation)
- `backend/src/sgw_platform/explain/prompts.py` — versioned prompt templates
- `backend/src/sgw_platform/explain/explanation.py` — per-asset explanation generator
- `backend/src/sgw_platform/explain/briefing.py` — executive briefing draft generator
- `backend/src/sgw_platform/explain/qa.py` — operator Q&A over structured retrieval
- Canonical eval set — 5–10 hand-crafted (input, expected output) pairs

### Steps
1. Define Pydantic schemas matching data-model §9 (`reasoning_summary[]`, `uncertainties[]`, `evidence[]`, etc.)
2. `OllamaProvider.chat_structured(schema, messages)` — passes schema in `format=` AND injects it into the system prompt (verified pattern from Phase 0 smoke), validates via Pydantic, retries once on failure
3. `OpenAIProvider.chat_structured(...)` — uses `response_format={"type": "json_schema", ...}` (native)
4. Retrieval assembles evidence from source records — never let the LLM invent IDs
5. Prompts versioned in code; every output logs `(prompt_version, model_version, provider)`
6. Cost tracking: every call increments prometheus counter with `sgw_llm_tokens_total{provider,direction,model}`
7. Canonical eval set exercised in a nightly-drift-style test

### Tests
- Schema conformance — every output validates against Pydantic
- Evidence IDs present + all referenced IDs exist in source data
- Canonical eval — LLM output for known input contains expected evidence IDs and structural elements
- Cost cap — test run stays under 5k tokens total

### Gate
```bash
pytest backend/tests/unit/test_explain.py backend/tests/evals/test_llm_canonical.py -v
```

---

## Phase 6 — FastAPI backend + observability + audit  *(est. 4 h)*

### Objective
HTTP surface for the frontend, with observability + audit + trust design baked in.

### Deliverables

**Endpoints** (`backend/src/sgw_platform/api/routes/`)
- `GET /health` — liveness
- `GET /ready` — readiness (models loaded, DB reachable)
- `GET /metrics` — prometheus scrape endpoint
- `GET /api/assets` — asset list with current risk + confidence + cluster ID
- `GET /api/assets/{id}` — asset drill-down: score, features, dependency chain, evidence, LLM explanation
- `GET /api/hazard-zones` — GeoJSON for map overlay
- `GET /api/forecasts/{sensor_id}` — Prophet forecast + uncertainty band
- `GET /api/anomalies` — current anomaly flags
- `POST /api/optimise/crews` — VRP plan
- `POST /api/decisions` — record operator accept/override/comment
- `GET /api/audit` — audit log tail
- `GET /api/governance/fairness` — current fairness metrics
- `POST /api/briefing/generate` — LLM-drafted executive briefing paragraph

**Observability** (`backend/src/sgw_platform/observability/`)
- Middleware: request logging with trace ID
- Metrics: request count, latency histogram, model call counters, OpenAI token counters, audit-write counter
- OpenTelemetry setup (optional; wired but no exporter required for MVP)

**Audit** (`backend/src/sgw_platform/audit/`)
- Postgres `audit_log` table (created in Phase 1 migration) with columns: `id, timestamp, user, action_type, subject_id, model_version, prompt_version, features_hash, previous_hash, current_hash, payload JSONB`
- UPDATE/DELETE blocked by trigger (raises exception); table is INSERT-only
- Hash chain: `current_hash = sha256(previous_hash || canonical_json(row))` — tamper-evident
- `audit.writer.append(entry)` — computes hash, inserts row, returns id
- `audit.verifier.verify_chain()` — replays hashes end-to-end and returns first divergence if any
- Every AI recommendation + every operator action writes an entry

### Steps
1. Wire all endpoints; each calls into the models/optimisation/explain layers
2. Every mutable endpoint writes an audit row before returning
3. Every response includes `X-Model-Version` and `X-Correlation-Id` headers
4. Middleware attaches trace ID + user + endpoint to structlog context
5. Rate limiting (60/min per client) for LLM-backed endpoints
6. CORS configured for `localhost:5173` (frontend dev)

### Tests
- Contract tests per endpoint (Pydantic response validation)
- Audit hash chain verifiable via `audit.verifier.verify_chain()` on a populated log
- Attempted UPDATE on `audit_log` raises the trigger exception (tamper protection)
- Rate limiting rejects the 61st request in a minute
- `/metrics` includes all expected counter names
- Integration: full decision cycle (recommendation → operator accept → audit) records both events, hash chain intact

### Gate
```bash
pytest backend/tests/integration -v && curl localhost:8000/health && curl localhost:8000/metrics
```

---

## Phase 7 — React frontend  *(est. 8 h)*

### Objective
Modern, clean operator dashboard covering the anchor pre-event workflow.

### Deliverables

**Layout** (`frontend/src/components/layout/`)
- Sidebar nav: Dashboard / Assets / Governance / Audit / Briefing
- Top bar: current hazard status + operator identity + notifications
- Main content router (React Router)
- Dark mode default (NOC-friendly); light-mode toggle

**Pages** (`frontend/src/pages/`)
- **Dashboard** (`/`): map (react-leaflet) + hazard overlay + asset risk heatmap + top-10 flagged assets list + current hazard-alerts banner
- **Asset drill-down** (`/assets/:id`): score panel, contributing factors, confidence, dependency chain visual, evidence list, LLM explanation card, accept/override/comment
- **Governance** (`/governance`): calibration curve, per-region calibration gaps, drift indicators, fairness gap table
- **Audit** (`/audit`): time-ordered audit log with filter by user / action / date range
- **Briefing** (`/briefing`): current operational picture aggregate + "Generate briefing" button → LLM-drafted paragraph

**Shared components** (`frontend/src/components/`)
- `ConfidenceBadge` — colour-coded confidence indicator (renders anywhere a score is shown)
- `EvidenceList` — clickable evidence IDs linking to source records
- `HITLPanel` — accept / override / comment affordance, standard across all recommendations
- `LoadingState`, `EmptyState`, `ErrorState` — consistent

**Design language**
- Tailwind + shadcn/ui primitives (Card, Badge, Button, Dialog, Tabs)
- Typography: system font stack, tight vertical rhythm
- Colour: neutral base, red/amber/green for severity (accessible contrast)
- Motion: sparse, no gratuitous animation

### Steps
1. Bootstrap Vite + Tailwind + shadcn/ui (`pnpm dlx shadcn@latest init`)
2. Configure react-leaflet with MapLibre tile URL
3. Configure TanStack Query with backend base URL from env
4. Configure Zod schemas mirroring backend Pydantic; infer TS types
5. Build Dashboard first (map + list) — end-to-end path validated
6. Build drill-down second (drives the drill down of the demo)
7. Governance + Audit + Briefing (in that order)
8. Ensure every recommendation renders `<HITLPanel />` + `<ConfidenceBadge />` + `<EvidenceList />`
9. Add loading / empty / error states everywhere

### Tests
- Unit tests per shared component (Vitest + RTL)
- Playwright e2e: dashboard renders → asset click → drill-down → accept → audit entry visible
- Accessibility check: no critical axe violations on any page

### Gate
```bash
pnpm test && pnpm test:e2e
```

---

## Phase 8 — End-to-end demo flow (Debby scenario)  *(est. 3 h)*

### Objective
Deterministic, replayable demo scenario spanning ingestion → risk → forecast → anomaly → optimisation → explanation → operator decision → audit.

### Deliverables
- `demo/scenarios/debby.py` — scripted scenario runner: loads Debby fixtures, injects the alert, advances simulated clock, triggers all model runs, snapshots UI state
- `demo/scenarios/idalia.py` — validation-reference scenario
- `demo/walkthrough.md` — populated by `demo-scribe` after each phase
- `demo/script.md` — 5–10 min narration script generated at end
- `Makefile` target `make demo` — runs Debby end-to-end + opens browser

### Steps
1. Scenario runner takes a simulated "now" timestamp
2. Loads fixtures relative to that timestamp
3. Fires the ingestion pipeline
4. Runs all AI capabilities against the resulting operational snapshot
5. Persists the demo state in a fixed location the frontend reads from
6. Playwright test replays the scenario headlessly and asserts UI outcomes

### Tests
- Playwright e2e: `make demo` produces the expected dashboard state
- Assertions on top-3 flagged assets, cascading impacts, crew plan feasibility
- Audit log after demo contains: 1 ingestion event, N recommendations, ≥ 1 operator accept, ≥ 1 override with comment

### Gate
```bash
make demo && pytest demo/tests/test_debby_e2e.py -v
```

---

## Phase 9 — Documentation + polish  *(est. 3 h)*

### Objective
Every deliverable required by the brief present, cross-linked, and readable by a mixed audience.

### Deliverables
- `README.md` (root) — orientation for a reviewer: what this is, how to run, where the docs live, deliverable checklist
- `backend/README.md` — setup, run, test, environment vars
- `frontend/README.md` — setup, run, test, design notes
- `demo/README.md` — how to reproduce the demo
- Update `docs/06_architecture.md` — refine diagrams based on what actually got built
- Update `docs/01_assumptions.md` — add any assumptions made during build
- Update `docs/00_working_notes.md` — build-time decision log entries
- `docs/adr/` — three ADRs for the most consequential build decisions

### Tests
- All docs render (no broken markdown)
- All internal doc links resolve
- `demo-scribe` walkthrough is complete and matches the actual demo flow

### Gate
Manual review + automated broken-link check.

---

## Phase 10 — Executive briefing + video recording  *(est. 4 h)*

Runs **after Phase 8 gate passes**, per user direction — exec briefing waits until an MVP demo exists.

### Deliverables
- `docs/05_exec_briefing.md` — final 2–3-page briefing, all sections drafted, aligned with what the demo actually shows
- 5–10 minute recorded video walkthrough
- Cross-check: PRD, exec briefing, prototype README and demo tell the *same* story

### Tests
- Video recorded and under 10 min
- Exec briefing consistent with PRD (no contradictions on scope, roadmap, or metrics)

### Gate
User sign-off.

---

## Testing philosophy (applies everywhere)

- **Every new module ships with tests.** No exceptions. Missing tests = failing gate.
- **Evals are tests too.** Model gates are eval thresholds, not just unit pass/fail.
- **Contract tests protect boundaries.** NOAA APIs and internal Pydantic schemas.
- **E2E covers the demo path.** If the demo can regress, e2e must catch it.
- **Snapshot tests for LLM outputs** on the canonical eval set only. Never on live outputs.

## Observability standards (applies everywhere)

- Structured JSON logs via structlog, always with correlation ID + user + action
- Prometheus metrics on: request latency, model call latency, OpenAI token usage, audit-log writes, error counters
- Audit log entries include model version + prompt version + features hash for full traceability
- Every AI recommendation surfaces confidence, uncertainty band, or anomaly score in both API and UI

## Trust standards (applies everywhere)

- Every recommendation → accept / override / comment surface in UI + audit event
- Every LLM explanation → cited evidence IDs, all resolvable in source data
- Every model call → logged with version, features, output; never silent
- Every fairness threshold breach → surfaces in Governance dashboard
- No LLM output enters an operational path without an operator accept

## Escalation triggers (stop the plan, ask the user)

- OpenAI monthly spend heading over $10 in dev
- Any phase 2× over its estimate
- A locked design principle (see CLAUDE.md) proves infeasible
- A dependency unavailable and no in-stack substitute
- A discovered fact materially changes the PRD

Escalation format: create `.claude/blocked.md` with:
- Phase + step
- Symptom (what happened)
- Attempted fixes (what didn't work)
- Minimum reproduction
- What decision is needed from the user

## Definition of done (whole build)

- Every phase gate passed
- `make demo` produces a deterministic, complete demo of the Debby scenario
- `demo/walkthrough.md` narrates the demo scene-by-scene
- `demo/script.md` reads clean as a 5–10 min voiceover
- Video recorded
- Exec briefing v1.0 drafted
- All docs cross-linked and consistent
- Repo submittable: clean history, no secrets, no committed raw NOAA archives, all deps pinned
