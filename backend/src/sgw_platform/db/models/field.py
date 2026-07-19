"""Field operations — crews, crew status, field reports."""

from __future__ import annotations

from datetime import datetime, time

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, Time
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base, TimestampMixin


class Crew(Base, TimestampMixin):
    __tablename__ = "crews"

    crew_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    crew_name: Mapped[str] = mapped_column(String(128), nullable=False)
    base_region: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    capability: Mapped[str] = mapped_column(String(128), nullable=False)
    shift_start: Mapped[time] = mapped_column(Time, nullable=False)
    shift_end: Mapped[time] = mapped_column(Time, nullable=False)


class CrewStatus(Base):
    __tablename__ = "crew_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    crew_id: Mapped[str] = mapped_column(String(64), ForeignKey("crews.crew_id"), index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    current_job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    travel_time_min: Mapped[int | None] = mapped_column(Integer, nullable=True)


class FieldReport(Base, TimestampMixin):
    __tablename__ = "field_reports"

    report_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.asset_id"), index=True)
    crew_id: Mapped[str] = mapped_column(String(64), ForeignKey("crews.crew_id"), index=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    observation_type: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    access_status: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_reference: Mapped[str | None] = mapped_column(String(256), nullable=True)
