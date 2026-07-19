"""Widen weather_alerts.alert_id to fit real NWS URNs.

Revision ID: 003_alert_id
Revises: 002_ops
Create Date: 2026-07-17

Real NWS alert IDs are `urn:oid:...` up to ~80 chars.
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "003_alert_id"
down_revision: str | None = "002_ops"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("weather_alerts", "alert_id", type_=sa.String(128))


def downgrade() -> None:
    op.alter_column("weather_alerts", "alert_id", type_=sa.String(64))
