#!/usr/bin/env bash
# Task runner — mirrors Makefile targets for environments without make (e.g. Windows).
# Usage: bash run.sh <target>

set -euo pipefail

TARGET="${1:-help}"

case "$TARGET" in
  help)
    echo "SGW platform tasks:"
    echo "  bash run.sh install         Install backend + frontend deps"
    echo "  bash run.sh dev             docker-compose up (postgres + backend + frontend)"
    echo "  bash run.sh dev-backend     Backend only"
    echo "  bash run.sh dev-frontend    Frontend only"
    echo "  bash run.sh lint            Backend + frontend lint"
    echo "  bash run.sh typecheck       mypy + tsc"
    echo "  bash run.sh test            All tests"
    echo "  bash run.sh test-backend    Backend tests"
    echo "  bash run.sh test-frontend   Frontend tests"
    echo "  bash run.sh evals           Model evals"
    echo "  bash run.sh db-up           Start postgres"
    echo "  bash run.sh db-migrate      Alembic upgrade head"
    echo "  bash run.sh db-reset        Drop + recreate + migrate + seed"
    echo "  bash run.sh db-seed         Seed raw data into Postgres"
    echo "  bash run.sh db-shell        psql shell"
    echo "  bash run.sh fixtures        Pull NOAA fixtures"
    echo "  bash run.sh data-mock       Generate synthetic data"
    echo "  bash run.sh train           Train models"
    echo "  bash run.sh demo            Run Debby scenario"
    echo "  bash run.sh clean           Remove build caches"
    ;;
  install)
    (cd backend && uv sync --all-extras)
    (cd frontend && pnpm install)
    ;;
  dev)
    docker compose up
    ;;
  dev-backend)
    (cd backend && uv run uvicorn sgw_platform.api.main:app --reload --host 0.0.0.0 --port 8000)
    ;;
  dev-frontend)
    (cd frontend && pnpm dev)
    ;;
  lint)
    (cd backend && uv run ruff check src tests)
    (cd frontend && pnpm lint)
    ;;
  typecheck)
    (cd backend && uv run mypy src)
    (cd frontend && pnpm typecheck)
    ;;
  test)
    bash "$0" test-backend
    bash "$0" test-frontend
    ;;
  test-backend)
    (cd backend && uv run pytest tests/unit tests/integration tests/contract -v)
    ;;
  test-frontend)
    (cd frontend && pnpm test)
    ;;
  test-e2e)
    (cd frontend && pnpm test:e2e)
    ;;
  evals)
    (cd backend && uv run pytest tests/evals -v)
    ;;
  db-up)
    docker compose up -d postgres
    ;;
  db-migrate)
    (cd backend && uv run alembic upgrade head)
    ;;
  db-downgrade)
    (cd backend && uv run alembic downgrade -1)
    ;;
  db-reset)
    docker compose down -v postgres || true
    docker compose up -d postgres
    echo "Waiting for Postgres to become healthy..."
    sleep 5
    bash "$0" db-migrate
    bash "$0" db-seed
    ;;
  db-seed)
    (cd backend && uv run python -m sgw_platform.scripts.seed_from_raw)
    ;;
  db-shell)
    docker exec -it sgw_postgres psql -U sgw -d sgw
    ;;
  fixtures)
    (cd backend && uv run python scripts/pull_coops_charleston.py)
    (cd backend && uv run python scripts/clip_digital_coast.py)
    (cd backend && uv run python scripts/clip_nhc_slosh.py)
    (cd backend && uv run python scripts/pull_nhc_tracks.py)
    (cd backend && uv run python scripts/pull_spc_cpc.py)
    (cd backend && uv run python scripts/pull_ncei_events.py)
    ;;
  data-mock)
    (cd backend && uv run python -m data.generators.run_all)
    ;;
  train)
    (cd backend && uv run python -m sgw_platform.models.train_all)
    ;;
  demo)
    (cd backend && uv run python -m demo.scenarios.debby)
    echo "Demo state loaded. Open http://localhost:5173"
    ;;
  build)
    (cd backend && uv build)
    (cd frontend && pnpm build)
    ;;
  clean)
    rm -rf backend/dist backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
    rm -rf frontend/dist frontend/node_modules/.vite
    find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
    ;;
  *)
    echo "Unknown target: $TARGET"
    exec bash "$0" help
    ;;
esac
