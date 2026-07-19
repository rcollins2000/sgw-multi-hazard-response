# SGW — Multi-Hazard Readiness & Response (AECOM AI Solution Engineer take-home)

An AI-enabled operational decision-support prototype for a fictional US utility, **Southeastern Grid & Water (SGW)**. Built as a take-home deliverable for the AECOM AI Solution Engineer role.

> **The LLM is a copilot, not the product.** Risk scores, forecasts, optimisation and hazard classifications are produced by dedicated ML / OR components (LightGBM, Prophet, OR-Tools, networkx). The LLM narrates, cites source IDs, and explains — never scores. Every recommendation is advisory, with accept / override / comment surfaced in the UI and an append-only audit log behind it.

- **Deadline:** Monday 2026-07-20
- **MVP workflow:** Multi-Hazard Readiness & Response — pre-event / early-onset phase across hurricane, flood, heatwave, wildfire (SC/GA/NC footprint)
- **Primary demo scenario:** Hurricane Debby (Aug 2024); Idalia (Aug 2023) as validation reference

## Deliverables

1. **PRD** for the technical delivery team — [docs/04_prd.md](docs/04_prd.md) *(v1.0, complete)*
2. **Executive briefing** — [docs/05_exec_briefing.md](docs/05_exec_briefing.md)
3. **Lightweight prototype + 5–10 min video demo** — MVP prototype complete; walkthrough + narration script in [demo/walkthrough.md](demo/walkthrough.md), runbook in [demo/README.md](demo/README.md)

## Current state (2026-07-17)

Phases 0–9 complete, 32/32 backend tests green, end-to-end verified through the browser. See [.claude/status.md](.claude/status.md) for the full gate report.

Working end-to-end:

- **Data layer** — PostGIS 3.4 operational schema with append-only audit + predictions tables; monthly partitioned `sensor_readings`; materialised view for the ops risk snapshot.
- **Six NOAA adapters** — real fixtures for Debby + Idalia, plus a live NWS Alerts adapter (24 live alerts at the time of the last run).
- **AI portfolio** — LightGBM regressor + RF baseline with calibration, Prophet forecasting with M2 tidal seasonality, Prophet-residual anomaly detection, OR-Tools VRP, networkx BFS + Louvain clustering, fairness auditing.
- **LLM copilot** — Ollama Cloud (`gpt-oss:120b`) with strict Pydantic-schema structured output, OpenAI fallback.
- **API** — FastAPI, 14 endpoints, tamper-evident hash-chained audit log.
- **UI** — React 19 + TypeScript strict, MapLibre + react-leaflet, HITL accept/override/comment.

## Quick start

Requires Docker Desktop + an OpenAI *or* Ollama Cloud API key.

```bash
cp .env.example .env         # then edit and add OPENAI_API_KEY or OLLAMA_API_KEY
make install                 # backend uv env + frontend pnpm install
make demo                    # docker-compose: postgres + backend + frontend
```

Open http://localhost:5173 for the dashboard, http://localhost:8000/docs for the OpenAPI spec.

More detail — including the guided Debby replay — in [demo/README.md](demo/README.md).

## Repo tour

- **[CLAUDE.md](CLAUDE.md)** — project instructions, guardrails, stack, conventions
- **[PLAN.md](PLAN.md)** — phase-gated execution plan with tests at every stage
- **[Makefile](Makefile)** — common commands: `make install`, `make dev`, `make test`, `make demo`
- **[.env.example](.env.example)** — copy to `.env` and fill in credentials
- **[backend/](backend/)** — Python 3.12 · FastAPI · SQLAlchemy 2.x async · Alembic · uv
- **[frontend/](frontend/)** — React 19 · TypeScript strict · Vite · Tailwind · shadcn/ui · react-leaflet · TanStack Query
- **[data/](data/)** — fragmented mock fixtures (per-source formats, per-system IDs, quality flags — ingestion is a first-class capability)
- **[infra/](infra/)** — Postgres init + optional Prometheus/Grafana profile
- **[demo/](demo/)** — walkthrough, narration script, screenshots, scenarios
- **[.claude/agents/](.claude/agents/)** — three specialist subagents (`test-orchestrator`, `dev-tracker`, `demo-scribe`) used to drive the build

## Design docs (read in this order)

- [docs/00_working_notes.md](docs/00_working_notes.md) — running scratchpad + decision log
- [docs/01_assumptions.md](docs/01_assumptions.md) — explicit assumptions register
- [docs/02_mvp_workflow.md](docs/02_mvp_workflow.md) — MVP workflow selection + alternatives considered
- [docs/03_plan.md](docs/03_plan.md) — 6-day plan to submission
- [docs/04_prd.md](docs/04_prd.md) — full PRD v1.0
- [docs/06_architecture.md](docs/06_architecture.md) — prototype architecture + six-adapter Hazard Data family
- [docs/07_data_model.md](docs/07_data_model.md) — mock dataset spec (fragmented on purpose)
- [docs/08_external_data_sources.md](docs/08_external_data_sources.md) — NOAA source registry + 6-day wiring plan

## Guiding principles

- **One coherent MVP workflow** — Multi-Hazard Readiness & Response — reused across PRD, exec briefing, prototype, demo and presentation
- **Hazard-conditional AI**, not one-off models — same platform reasons across hurricane, flood, heatwave and wildfire, coastal and inland
- **Fragmentation-by-design in the mock** — the ingestion + ID-resolution layer is a technical-maturity signal, not hidden by a pre-joined dataset
- **Assumptions before answers** — every gap is filled with a reasoned, defensible assumption
- **AI beyond LLMs** — forecasting, anomaly detection, optimisation, predictive ML are first-class; the LLM narrates and explains, never produces the risk score
- **Users are SGW operational staff, not the 8M residents** (residents are beneficiaries)
- **Credible path from prototype → production**, not a production build

## Notes for reviewers

- This is a take-home submission — code is optimised for a legible walkthrough of the *approach*, not for production scale.
- NOAA data is redistributed under NOAA's open-data policy; only small clipped WGS84 fixtures are committed (see [.gitignore](.gitignore)).
- The `.claude/agents/` subagents and [CLAUDE.md](CLAUDE.md) are included to make the AI-assisted build methodology inspectable, not because they're required to run the demo.
