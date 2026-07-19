"""Load pulled NOAA fixtures into Postgres.

Idempotent: replaces the weather rows on each run (append-only rules do NOT apply
to weather_observations/forecasts/alerts/hurricane_tracks — those are refreshable ingest).

Usage:
    python -m scripts.seed_noaa_fixtures
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from pathlib import Path

import typer
from geoalchemy2.shape import from_shape
from shapely.geometry import LineString, Polygon
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.db.models import (
    HurricaneTrack,
    WeatherAlert,
    WeatherObservation,
)
from sgw_platform.db.session import session_scope
from sgw_platform.observability.logging import configure_logging, get_logger

configure_logging()
log = get_logger("seed_noaa")

app = typer.Typer(add_completion=False)


async def _truncate(session: AsyncSession) -> None:
    await session.execute(
        text("TRUNCATE weather_observations, weather_alerts, weather_forecasts, hurricane_tracks CASCADE;")
    )


async def _load_coops(session: AsyncSession, path: Path, source_label: str) -> int:
    if not path.exists():
        log.warning("fixture.missing", path=str(path))
        return 0
    payload = json.loads(path.read_text())
    count = 0
    for obs in payload["observations"]:
        session.add(
            WeatherObservation(
                observation_time=datetime.fromisoformat(obs["observation_time"]),
                station_id=payload["station_id"],
                latitude=payload["latitude"],
                longitude=payload["longitude"],
                water_level_ft=obs.get("water_level_ft"),
                source=f"NOS_COOPS:{source_label}",
            )
        )
        count += 1
    await session.flush()
    return count


async def _load_alerts(session: AsyncSession, path: Path) -> int:
    if not path.exists():
        log.warning("fixture.missing", path=str(path))
        return 0
    payload = json.loads(path.read_text())
    seen: set[str] = set()
    count = 0
    for a in payload["alerts"]:
        alert_id = a["alert_id"]
        if alert_id in seen:  # NWS sometimes duplicates across state queries
            continue
        seen.add(alert_id)
        session.add(
            WeatherAlert(
                alert_id=alert_id,
                hazard_type=a["hazard_type"],
                severity=a["severity"],
                urgency=a["urgency"],
                issued_at=datetime.fromisoformat(a["issued_at"]),
                expires_at=datetime.fromisoformat(a["expires_at"]),
                headline=a["headline"][:2000],
                payload=a["raw"],
                source="NWS_alerts_active",
            )
        )
        count += 1
    await session.flush()
    return count


async def _load_track(session: AsyncSession, path: Path) -> int:
    if not path.exists():
        log.warning("fixture.missing", path=str(path))
        return 0
    payload = json.loads(path.read_text())
    props = payload["properties"]
    cone_coords: list[list[float]] = []
    track_coords: list[list[float]] = []
    for feat in payload["features"]:
        if feat["geometry"]["type"] == "Polygon":
            cone_coords = feat["geometry"]["coordinates"][0]
        elif feat["geometry"]["type"] == "LineString":
            track_coords = feat["geometry"]["coordinates"]

    if not cone_coords or not track_coords:
        log.warning("track.malformed", path=str(path))
        return 0

    # Normalise the hand-drawn cone via Shapely's buffer(0) trick which resolves
    # self-intersections + non-simple polygons. Matches what production ingestion
    # would do with real NHC shapefiles via ST_MakeValid.
    cone_poly = Polygon(cone_coords).buffer(0)
    if cone_poly.geom_type != "Polygon":
        # If buffer(0) produced a MultiPolygon, take the largest ring.
        cone_poly = max(cone_poly.geoms, key=lambda g: g.area)

    session.add(
        HurricaneTrack(
            storm_id=props["storm_id"],
            storm_name=props["storm_name"],
            advisory_number=props["advisory_number"],
            issued_at=datetime.fromisoformat(props["issued_at"]),
            cone=from_shape(cone_poly, srid=4326),
            track_line=from_shape(LineString(track_coords), srid=4326),
            source=props["source"],
        )
    )
    await session.flush()
    return 1


@app.command()
def main(
    data_dir: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data",
        help="Data root",
    ),
) -> None:
    weather = data_dir / "raw" / "weather"

    async def _run() -> None:
        async with session_scope() as session:
            await _truncate(session)
            coops_debby = await _load_coops(session, weather / "coops_charleston_debby.json", "debby_2024")
            coops_idalia = await _load_coops(session, weather / "coops_charleston_idalia.json", "idalia_2023")
            alerts = await _load_alerts(session, weather / "nws_alerts_sample.json")
            track_debby = await _load_track(session, weather / "hurricane_track_debby.geojson")
            track_idalia = await _load_track(session, weather / "hurricane_track_idalia.geojson")
        log.info(
            "seed_noaa.done",
            coops_debby=coops_debby,
            coops_idalia=coops_idalia,
            nws_alerts=alerts,
            tracks=track_debby + track_idalia,
        )

    asyncio.run(_run())


if __name__ == "__main__":
    app()
