# SGW Platform — Backend

Python 3.12+ / FastAPI / PostgreSQL 16 + PostGIS 3.4 / SQLAlchemy 2 (async) / Alembic.

## Setup

```bash
# From backend/
uv sync --all-extras
```

Requires Postgres running (via `docker compose up -d postgres` from project root).

## Common commands

```bash
uv run uvicorn sgw_platform.api.main:app --reload    # dev server
uv run alembic upgrade head                          # migrations
uv run alembic revision --autogenerate -m "..."      # new migration
uv run pytest tests/unit tests/integration -v        # tests
uv run pytest tests/evals -v                         # model evals
uv run ruff check src tests                          # lint
uv run ruff format src tests                         # format
uv run mypy src                                      # typecheck
```

## Layout

- `src/sgw_platform/api/` — FastAPI routes + app factory
- `src/sgw_platform/db/` — SQLAlchemy models, session, base
- `src/sgw_platform/adapters/` — NOAA + internal source adapters (six-adapter family)
- `src/sgw_platform/ingestion/` — ID resolution, quality flags, freshness metadata
- `src/sgw_platform/features/` — feature builder over PostGIS
- `src/sgw_platform/models/` — risk (GBM+RF), forecasting (Prophet), anomaly (Prophet-residual)
- `src/sgw_platform/optimisation/` — OR-Tools VRP
- `src/sgw_platform/graph/` — networkx dependency traversal + Louvain
- `src/sgw_platform/explain/` — OpenAI copilot layer (structured outputs)
- `src/sgw_platform/governance/` — fairness, drift, calibration
- `src/sgw_platform/audit/` — append-only audit writer + hash-chain verifier
- `src/sgw_platform/observability/` — structlog + prometheus metrics
- `alembic/` — migrations
