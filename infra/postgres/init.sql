-- SGW Postgres init — runs on first container boot only.
-- Alembic migrations do the heavy lifting; this just ensures extensions
-- are available before the app connects.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Diagnostics
DO $$
BEGIN
    RAISE NOTICE 'PostGIS % ready', PostGIS_Version();
END $$;
