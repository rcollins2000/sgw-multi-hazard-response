"""Asset registry, service areas, hazard zones, regions."""

from __future__ import annotations

from datetime import date

from geoalchemy2 import Geometry
from sqlalchemy import Date, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base, TimestampMixin


class Region(Base):
    __tablename__ = "regions"

    region_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    state_code: Mapped[str] = mapped_column(String(2), nullable=False)
    footprint: Mapped[str | None] = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=True)


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"

    asset_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    asset_name: Mapped[str] = mapped_column(String(256), nullable=False)
    asset_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    utility_domain: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    region: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    geom: Mapped[str] = mapped_column(Geometry("GEOMETRY", srid=4326), nullable=False)
    operational_status: Mapped[str] = mapped_column(String(32), nullable=False, default="operational")
    criticality_rating: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    condition_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    commissioned_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    design_capacity: Mapped[float | None] = mapped_column(Float, nullable=True)
    capacity_unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    service_population: Mapped[int | None] = mapped_column(Integer, nullable=True)
    flood_zone: Mapped[str | None] = mapped_column(String(16), nullable=True)
    ground_elevation_ft: Mapped[float | None] = mapped_column(Float, nullable=True)
    backup_power: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_inspection_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class ServiceArea(Base, TimestampMixin):
    __tablename__ = "service_areas"

    service_area_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    service_area_name: Mapped[str] = mapped_column(String(256), nullable=False)
    geom: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    population: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    priority_facilities: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    hospitals: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    emergency_shelters: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    primary_asset_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class HazardZone(Base, TimestampMixin):
    __tablename__ = "hazard_zones"

    hazard_zone_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    hazard_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity_band: Mapped[str | None] = mapped_column(String(32), nullable=True)
    source: Mapped[str] = mapped_column(String(128), nullable=False)  # e.g. FEMA, NHC_SLOSH, SPC
    geom: Mapped[str] = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
