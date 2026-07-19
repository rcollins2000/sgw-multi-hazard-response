"""Maintenance — work orders and inspection history."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base, TimestampMixin


class WorkOrder(Base, TimestampMixin):
    __tablename__ = "work_orders"

    work_order_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.asset_id"), index=True)
    work_type: Mapped[str] = mapped_column(String(32), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    created_at_source: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    estimated_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    assigned_team: Mapped[str | None] = mapped_column(String(64), nullable=True)


class InspectionHistory(Base, TimestampMixin):
    __tablename__ = "inspection_history"

    inspection_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_id: Mapped[str] = mapped_column(String(64), ForeignKey("assets.asset_id"), index=True)
    inspected_at: Mapped[date] = mapped_column(Date, nullable=False)
    inspection_type: Mapped[str] = mapped_column(String(32), nullable=False)
    condition_score: Mapped[int] = mapped_column(Integer, nullable=False)
    defect_found: Mapped[bool] = mapped_column(nullable=False, default=False)
    severity: Mapped[str | None] = mapped_column(String(16), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
