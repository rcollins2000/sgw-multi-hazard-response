#!/usr/bin/env bash
# Docker entrypoint for the SGW backend.
#
# Bootstraps the database on first boot and starts the API server.
# Every step is idempotent so restarting the container is safe:
#   1. Wait for Postgres to be reachable.
#   2. Run Alembic migrations to head (safe to re-run).
#   3. Seed mock + NOAA fixtures ONLY if the `assets` table is empty
#      (this is what makes it idempotent — a restarted container skips
#       the seed step and boots to a warm DB in seconds).
#   4. Start uvicorn (no --reload; this is not the dev shape).

set -euo pipefail

# ---- 1. Wait for Postgres -------------------------------------------------
echo "[entrypoint] waiting for postgres to accept connections…"
for i in $(seq 1 60); do
  if uv run python -c "
import asyncio, asyncpg, os, sys
async def check():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'].replace('postgresql+asyncpg://', 'postgresql://'))
    await conn.close()
try:
    asyncio.run(check())
except Exception as e:
    sys.exit(1)
" 2>/dev/null; then
    echo "[entrypoint] postgres is up (took ${i}s)"
    break
  fi
  if [ "$i" = "60" ]; then
    echo "[entrypoint] postgres never came up — exiting" >&2
    exit 1
  fi
  sleep 1
done

# ---- 2. Run migrations ----------------------------------------------------
echo "[entrypoint] running alembic migrations…"
uv run alembic upgrade head

# ---- 3. Idempotent seed ---------------------------------------------------
echo "[entrypoint] checking if the database is already seeded…"
ROW_COUNT=$(uv run python -c "
import asyncio, asyncpg, os
async def count():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'].replace('postgresql+asyncpg://', 'postgresql://'))
    try:
        n = await conn.fetchval('SELECT COUNT(*) FROM assets')
        print(n)
    finally:
        await conn.close()
asyncio.run(count())
" 2>&1 | tail -n 1)

if [ "$ROW_COUNT" = "0" ]; then
  echo "[entrypoint] assets table empty — seeding synthetic + NOAA fixtures (~30s first boot only)…"
  # The generate + seed pair is deterministic (seed=42) so the same data
  # comes out every time; the NOAA fixtures are packaged into the image so
  # this step doesn't touch the network.
  uv run python -m scripts.generate_mock_data || true
  uv run python -m scripts.seed_from_raw
  uv run python -m scripts.seed_noaa_fixtures
  echo "[entrypoint] seed complete."
else
  echo "[entrypoint] already seeded (${ROW_COUNT} assets present) — skipping."
fi

# ---- 4. Serve -------------------------------------------------------------
echo "[entrypoint] starting uvicorn on 0.0.0.0:8000"
exec uv run uvicorn sgw_platform.api.main:app --host 0.0.0.0 --port 8000
