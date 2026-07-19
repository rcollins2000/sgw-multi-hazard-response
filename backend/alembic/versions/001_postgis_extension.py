"""Enable PostGIS extension.

Revision ID: 001_postgis
Revises:
Create Date: 2026-07-15

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "001_postgis"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis_topology;")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto;")


def downgrade() -> None:
    op.execute("DROP EXTENSION IF EXISTS pgcrypto;")
    op.execute("DROP EXTENSION IF EXISTS postgis_topology;")
    op.execute("DROP EXTENSION IF EXISTS postgis;")
