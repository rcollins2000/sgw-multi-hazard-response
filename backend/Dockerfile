# SGW backend — Python 3.12 + uv.
FROM python:3.12-slim-bookworm

# System deps for prophet (cmdstanpy needs a compiler), geopandas, and psycopg2.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    curl \
    libpq-dev \
    gdal-bin \
    libgdal-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Cache-friendly layer: lockfile + pyproject first
COPY pyproject.toml uv.lock* ./
RUN uv sync --frozen --no-install-project --all-extras || uv sync --no-install-project --all-extras

# Then source
COPY src ./src
COPY alembic ./alembic
COPY alembic.ini ./

# Install project
RUN uv sync --all-extras

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "sgw_platform.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
