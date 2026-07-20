# SGW platform — common commands.
# Prefer these targets over remembering long invocations.

.PHONY: help
help:
	@echo "SGW platform commands:"
	@echo "  make install         Install backend + frontend deps"
	@echo "  make dev             Run backend + frontend + observability locally"
	@echo "  make dev-backend     Backend only"
	@echo "  make dev-frontend    Frontend only"
	@echo "  make lint            Lint backend (ruff) + frontend (eslint)"
	@echo "  make typecheck       mypy backend + tsc frontend"
	@echo "  make test            All tests (unit + integration + contract)"
	@echo "  make test-backend    Backend tests only"
	@echo "  make test-frontend   Frontend unit tests only"
	@echo "  make test-e2e        Playwright e2e"
	@echo "  make evals           Model evaluation suite"
	@echo "  make db-up           Start Postgres+PostGIS only"
	@echo "  make db-migrate      Run Alembic migrations to head"
	@echo "  make db-downgrade    Roll back one migration"
	@echo "  make db-reset        Drop DB, recreate, migrate, seed"
	@echo "  make db-seed         Load raw data into Postgres"
	@echo "  make db-shell        psql shell into the Postgres container"
	@echo "  make fixtures        Pull NOAA fixtures (Debby + Idalia + Digital Coast + SLOSH + SPC + NCEI)"
	@echo "  make data-mock       Generate synthetic operational data (raw files)"
	@echo "  make train           Train risk + forecast + anomaly models"
	@echo "  make demo            Run the Debby scenario end-to-end"
	@echo "  make build           Build backend + frontend for production"
	@echo "  make clean           Remove build artefacts + caches"

.PHONY: install
install:
	cd backend && uv sync --all-extras
	cd frontend && pnpm install

.PHONY: dev
dev:
	docker-compose up

.PHONY: dev-backend
dev-backend:
	cd backend && uv run uvicorn sgw_platform.api.main:app --reload --host 0.0.0.0 --port 8000

.PHONY: dev-frontend
dev-frontend:
	cd frontend && pnpm dev

.PHONY: lint
lint:
	cd backend && uv run ruff check src tests
	cd frontend && pnpm lint

.PHONY: typecheck
typecheck:
	cd backend && uv run mypy src
	cd frontend && pnpm typecheck

.PHONY: test
test: test-backend test-frontend

.PHONY: test-backend
test-backend:
	cd backend && uv run pytest tests/unit tests/integration tests/contract -v

.PHONY: test-frontend
test-frontend:
	cd frontend && pnpm test

.PHONY: test-e2e
test-e2e:
	cd frontend && pnpm test:e2e

.PHONY: evals
evals:
	cd backend && uv run pytest tests/evals -v

.PHONY: db-up
db-up:
	docker-compose up -d postgres

.PHONY: db-migrate
db-migrate:
	cd backend && uv run alembic upgrade head

.PHONY: db-downgrade
db-downgrade:
	cd backend && uv run alembic downgrade -1

.PHONY: db-reset
db-reset:
	docker-compose down -v postgres
	docker-compose up -d postgres
	@echo "Waiting for Postgres to become healthy..."
	@sleep 5
	$(MAKE) db-migrate
	$(MAKE) db-seed

.PHONY: db-seed
db-seed:
	cd backend && uv run python -m scripts.seed_from_raw
	cd backend && uv run python -m scripts.seed_noaa_fixtures

.PHONY: db-shell
db-shell:
	docker exec -it sgw_postgres psql -U sgw -d sgw

.PHONY: fixtures
fixtures:
	cd backend && uv run python -m scripts.pull_noaa_fixtures

.PHONY: data-mock
data-mock:
	cd backend && uv run python -m scripts.generate_mock_data

.PHONY: train
train:
	cd backend && uv run python -m sgw_platform.models.train_all

.PHONY: demo
demo:
	@echo "See demo/README.md for the full runbook and demo/walkthrough.md for the narration script."
	@echo "Open http://localhost:5173 after 'make dev-backend' and 'make dev-frontend' in separate terminals."

.PHONY: build
build:
	cd backend && uv build
	cd frontend && pnpm build

.PHONY: clean
clean:
	rm -rf backend/dist backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
	rm -rf frontend/dist frontend/node_modules/.vite
	find . -type d -name __pycache__ -exec rm -rf {} +
