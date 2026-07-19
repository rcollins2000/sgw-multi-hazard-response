# CLAUDE.md — SGW Platform build instructions

Read this file first on every session in this repo. It tells you what this project is, what to preserve, what to build, and how to work here.

## What this is

The **AECOM AI Solution Engineer take-home** — a lightweight prototype + supporting documents for a fictional US utility (Southeastern Grid & Water). The user is applying for a role and this repo is a deliverable.

- **Deadline:** Monday 2026-07-20
- **Product framing:** AI-enabled operational decision-support platform, *not* a chatbot
- **MVP workflow:** Multi-Hazard Readiness & Response, pre-event / early-onset phase, four hazards (hurricane, flood, heatwave, wildfire), SC/GA/NC footprint
- **Primary demo scenario:** Hurricane Debby (Aug 2024); Idalia (Aug 2023) as validation reference

## Read these before making non-trivial changes

1. [docs/04_prd.md](docs/04_prd.md) — full PRD v1.0 — source of truth for scope
2. [docs/02_mvp_workflow.md](docs/02_mvp_workflow.md) — AI capability portfolio (locked)
3. [docs/01_assumptions.md](docs/01_assumptions.md) — assumptions register
4. [docs/07_data_model.md](docs/07_data_model.md) — mock dataset spec (fragmented on purpose)
5. [docs/08_external_data_sources.md](docs/08_external_data_sources.md) — NOAA source registry
6. [docs/06_architecture.md](docs/06_architecture.md) — architecture + six-adapter Hazard Data family
7. [PLAN.md](PLAN.md) — phased execution plan with per-phase tests

If a proposed change contradicts any of these, update the doc first (with reasoning in [docs/00_working_notes.md](docs/00_working_notes.md)) and then make the change. Docs and code stay in lockstep.

## Non-negotiable design principles

These have been argued through in the docs. Do not silently revise them.

1. **The LLM is a copilot, not the product.** Never let the LLM produce risk scores, forecasts, optimisation plans, or hazard classifications. The LLM narrates, cites evidence, drafts, and answers questions over structured retrieval. Only.
2. **Every AI recommendation is advisory.** UI must always expose accept / override / comment. Backend must always log the operator action alongside the recommendation.
3. **Immutable audit log.** Every recommendation, every operator action, every model version. Append-only. No mutations.
4. **Evidence citation on every recommendation.** LLM explanations must cite the specific source IDs (alert IDs, work-order IDs, sensor IDs, field-report IDs) that fed the reasoning.
5. **Confidence surfaced, not hidden.** Every prediction has a confidence signal (calibrated probability, uncertainty band, anomaly-score threshold distance). It must be visible in the UI.
6. **Fragmented on purpose.** The mock data has different formats per source, different IDs per system (crosswalk resolution required), quality flags, freshness metadata. Do not collapse this into a clean pre-joined dataset — the ingestion layer is a first-class capability.
7. **NOAA is the reference data stack.** The six-adapter Hazard Data family isolates provider choice. Do not hard-code provider assumptions into risk / forecast / UI code.
8. **Users are SGW operational staff, not residents.** Every UX decision should serve NOC / Emergency / Field / Maintenance personas.

## Stack (locked)

**Backend — Python 3.12**
- `uv` for env + deps management
- FastAPI + Pydantic v2 for API
- **PostgreSQL 16 + PostGIS 3.4** as the operational data store (source-of-truth for canonical data; raw files under `data/raw/` represent the fragmented source systems)
- **SQLAlchemy 2.x (async, typed)** for the ORM; **Alembic** for migrations
- **asyncpg** as the Postgres driver
- structlog for JSON logging
- OpenTelemetry SDK for traces (optional wiring)
- prometheus-client for /metrics
- pytest + pytest-asyncio + testcontainers-postgres for tests
- ruff for lint + format; mypy for types
- lightgbm + scikit-learn (GBM + RF baseline + calibration)
- prophet (Meta) for forecasting + residual anomaly
- ortools for VRP / optimisation
- networkx + python-louvain for graph + community detection
- httpx (async) for NOAA REST APIs
- geopandas + pyproj + Shapely for geospatial + CRS + geometry handling
- s3fs (anonymous config) for NOAA Open Data
- openai (SDK v1+) for LLM

**Frontend — React 18 + TypeScript strict**
- Vite for dev server + build
- Tailwind CSS + shadcn/ui (Radix primitives — accessible by default)
- react-leaflet (with MapLibre tiles) for maps
- Recharts for calibration + forecast band + fairness dashboards
- TanStack Query for server state
- Zustand for local global state
- Playwright for e2e
- Vitest + React Testing Library for unit

**LLM** — Provider-swappable. Default: **Ollama Cloud** (`ollama` SDK, model `gpt-oss:120b`, `host=https://ollama.com`, `Authorization: Bearer $OLLAMA_API_KEY`). Fallback: OpenAI (`openai` SDK v1+, `gpt-5.6`). Chosen provider comes from `LLM_PROVIDER` env var.

Structured outputs pattern (proven for gpt-oss:120b in smoke test):
1. Define Pydantic model → derive JSON schema
2. Pass schema in BOTH `format=` parameter AND the system prompt (gpt-oss:120b will invent its own schema if not reinforced in the prompt — this was verified in Phase 0 smoke testing and is logged in working notes)
3. Validate response with Pydantic
4. Retry once with corrective feedback on validation failure; escalate on second failure

**Dev orchestration** — docker-compose for the demo stack (postgres + backend + frontend + optional observability). Makefile for common commands.

## Coding conventions

**Python:**
- Type hints on all public functions
- Pydantic models for anything crossing a boundary (API, DB, external adapter)
- SQLAlchemy 2.x async style (`AsyncSession`, `Mapped[]` annotations); no legacy `Query()` API
- Every schema change goes through Alembic — never edit tables by hand
- structlog with `bind()` for request-scoped context
- Async where I/O-bound; sync where CPU-bound
- Small modules over god-modules; one concept per file
- Never `print` — always structlog
- Never `os.getenv(...)` in business code — use a settings module with `pydantic-settings`

**Data engineering:**
- PostGIS geometry columns for anything spatial — never store WKT strings as text; use `Geometry("POINT", srid=4326)` etc.
- JSONB for semi-structured payloads (LLM outputs, raw evidence bundles, adapter metadata)
- `sensor_readings` table partitioned by month (declarative partitioning) for scale demo
- Append-only tables (`audit_log`, `predictions`) enforced by trigger — no UPDATE/DELETE allowed
- Materialised views for the operational risk snapshot; `REFRESH MATERIALIZED VIEW CONCURRENTLY` on demand
- Every ingestion write includes `source_system`, `source_id`, `ingested_at`, `quality_flag` for lineage

**TypeScript / React:**
- Strict mode always; no `any` unless justified in comment
- Functional components + hooks
- Colocate component + test + styles
- Server state via TanStack Query; local state via useState/Zustand
- Zod schemas for anything the API returns; derived TS types from Zod
- shadcn/ui primitives before custom UI

**Testing:**
- Every new module ships with tests
- Every AI capability ships with an eval (calibration / MAPE / precision-recall / constraint-satisfaction as appropriate)
- Every API endpoint has a contract test
- E2E covers the Debby demo scenario end-to-end
- Tests are the phase gate — plan cannot advance without passing tests

**Commits:**
- Conventional-ish (`feat:`, `fix:`, `docs:`, `test:`, `chore:`)
- Keep commits small and thematic
- Never commit secrets, model artefacts, or `data/raw` NOAA downloads (see `.gitignore`)

## What NOT to do

- Do not commit anything under `data/raw/` beyond clipped WGS84 GeoJSON fixtures (see `.gitignore`)
- Do not hard-code the OpenAI API key or any credential — always `.env` via `pydantic-settings`
- Do not add a chat UI as a primary surface — copilot is a panel, not the product
- Do not bypass the audit log for "just this one operation"
- Do not let LLM output free text into operational decisions (structured output only, schemas enforced)
- Do not introduce a new AI technique not in the [locked portfolio](docs/02_mvp_workflow.md) without updating the PRD and working notes first
- Do not create documentation files unless the plan calls for them (avoid drift)

## Subagents

Three specialist subagents live in `.claude/agents/`. Use them when their scope matches:

- **`test-orchestrator`** — runs test suites (backend, frontend, model evals), reports pass/fail + metrics. Invoke after finishing a phase or before advancing.
- **`dev-tracker`** — reads PLAN.md, inspects the repo, updates `.claude/status.md` with current phase, completed items, blockers, next up. Invoke at the start of a session and after each phase.
- **`demo-scribe`** — documents workflow scenes as they're built into `demo/walkthrough.md`; produces a scene-by-scene narration script for the 5–10 min video. Invoke after building a user-visible feature.

## Working style

- Follow PLAN.md phase-by-phase. Do not skip phases. Do not partially complete a phase and start the next.
- Tests are the definition of done. A phase is not complete until its tests are green.
- If blocked, write `.claude/blocked.md` with symptom + attempted fixes + minimum reproduction, and stop that phase. Continue on independent work if any.
- Update `docs/00_working_notes.md` with any decision that changes a documented assumption or architectural choice.
- Prefer editing existing files to creating new ones.
- Keep the workspace clean: no dead code, no TODO comments (either do it or add to plan).

## Escalation

Escalate to the user (stop and ask) only if:
- A locked assumption or design principle must be revisited
- A dependency is unavailable and no substitute is viable
- The plan is materially wrong for the discovered facts
- Cost / time budget is at risk (OpenAI spend > $10, or a phase is 2x over estimate)

Otherwise: make the reasonable call, log it in working notes, continue.
