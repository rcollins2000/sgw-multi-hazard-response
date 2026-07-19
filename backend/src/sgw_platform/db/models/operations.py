"""Operations — sensor readings (partitioned), incidents, outages."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base, TimestampMixin


class SensorReading(Base):
    """SCADA / IoT sensor readings — partitioned by month on `timestamp`.

    Composite PK (timestamp, sensor_id) required for declarative partitioning.
    Partitions created by migration + `ensure_partition` helper.
    """

    __tablename__ = "sensor_readings"
    __table_args__ = {"postgresql_partition_by": "RANGE (timestamp)"}

    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    sensor_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    metric: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(16), nullable=False)
    quality_flag: Mapped[str] = mapped_column(String(16), nullable=False, index=True)


class Incident(Base, TimestampMixin):
    __tablename__ = "incidents"

    incident_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    incident_type: Mapped[str] = mapped_column(String(64), nullable=False)
    region: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    primary_asset_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("assets.asset_id"), nullable=True, index=True
    )
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    people_affected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lead_team: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    response_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_asset_ids: Mapped[dict[str, object] | None] = mapped_column(JSONB, nullable=True)


class Outage(Base, TimestampMixin):
    __tablename__ = "outages"

    outage_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    incident_id: Mapped[str | None] = mapped_column(
        String(64), ForeignKey("incidents.incident_id"), nullable=True, index=True
    )
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.asset_id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    restored_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    customers_affected: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cause: Mapped[str | None] = mapped_column(String(128), nullable=True)
