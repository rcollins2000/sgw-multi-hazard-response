# SGW backend — Python 3.12 + uv. Self-contained image for `docker compose`
# reviewer runs — bakes in the deterministic seed data + NOAA fixtures so
# `docker compose up --build -d` gives a working stack without a separate
# seed step. Seed logic is idempotent (see docker_entrypoint.sh).
#
# NOTE: build context is the REPO ROOT (see docker-compose.yml), not the
# backend directory. This lets us COPY the top-level data/ directory into
# the image without symlinks.
FROM python:3.12-slim-bookworm

# System deps for Prophet (cmdstanpy needs a compiler), geopandas + pyproj,
# and healthcheck curl.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    curl \
    libpq-dev \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Cache-friendly layer: lockfile + pyproject first so a source-only change
# doesn't reinstall all deps. Paths are relative to the repo root (see NOTE
# above) so backend/ prefix is needed.
COPY backend/pyproject.toml backend/uv.lock* backend/README.md ./
RUN uv sync --frozen --no-install-project --all-extras || uv sync --no-install-project --all-extras

# Application source
COPY backend/src ./src
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY backend/scripts ./scripts
COPY backend/tests ./tests

# Install project
RUN uv sync --all-extras

# Bake in the seed data + NOAA fixtures (~2.4MB total). This is what makes
# the image self-contained — the entrypoint's seed step doesn't need to hit
# the network for NOAA fixtures.
COPY data /data

# Entrypoint script — waits for postgres, migrates, seeds if empty, serves.
RUN chmod +x scripts/docker_entrypoint.sh

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --retries=6 --start-period=45s \
    CMD curl -f http://localhost:8000/api/status || exit 1
ENTRYPOINT ["./scripts/docker_entrypoint.sh"]
