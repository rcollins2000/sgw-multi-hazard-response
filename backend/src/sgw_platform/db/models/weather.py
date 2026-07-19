"""Weather + hazard — observations, forecasts, alerts, hurricane tracks."""

from __future__ import annotations

from datetime import date, datetime

from geoalchemy2 import Geometry
from sqlalchemy import Date, DateTime, Float, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base


class WeatherObservation(Base):
    __tablename__ = "weather_observations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    observation_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    station_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    rainfall_1h_in: Mapped[float | None] = mapped_column(Float, nullable=True)
    rainfall_24h_in: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_speed_mph: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_gust_mph: Mapped[float | None] = mapped_column(Float, nullable=True)
    temperature_f: Mapped[float | None] = mapped_column(Float, nullable=True)
    river_level_ft: Mapped[float | None] = mapped_column(Float, nullable=True)
    water_level_ft: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(64), nullable=False)  # NWS | NOS_COOPS | synthetic


class WeatherForecast(Base):
    __tablename__ = "weather_forecasts"

    forecast_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    valid_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    valid_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    region: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    forecast_horizon_hours: Mapped[int] = mapped_column(nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)  # full forecast body
    source: Mapped[str] = mapped_column(String(64), nullable=False)


class WeatherAlert(Base):
    __tablename__ = "weather_alerts"

    alert_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    hazard_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    urgency: Mapped[str] = mapped_column(String(16), nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    headline: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False)


class HurricaneTrack(Base):
    __tablename__ = "hurricane_tracks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    storm_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    storm_name: Mapped[str] = mapped_column(String(64), nullable=False)
    advisory_number: Mapped[int] = mapped_column(nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    cone: Mapped[str] = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    track_line: Mapped[str] = mapped_column(Geometry("LINESTRING", srid=4326), nullable=False)
    source: Mapped[str] = mapped_column(String(64), nullable=False, default="NHC")


class HistoricalEvent(Base):
    """NCEI Storm Events records."""

    __tablename__ = "historical_events"

    event_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(2), nullable=False, index=True)
    begin_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    damage_property_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    damage_crops_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    deaths_direct: Mapped[int] = mapped_column(nullable=False, default=0)
    injuries_direct: Mapped[int] = mapped_column(nullable=False, default=0)
    episode_narrative: Mapped[str | None] = mapped_column(Text, nullable=True)
