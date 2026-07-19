"""Pull real NOAA fixtures for Debby (primary) + Idalia (validation).

Deliverables:
- data/raw/weather/coops_charleston_debby.json    — CO-OPS 8665530 water levels 2024-08-03 to 2024-08-09
- data/raw/weather/coops_charleston_idalia.json   — CO-OPS 8665530 water levels 2023-08-28 to 2023-09-01
- data/raw/weather/nws_alerts_sample.json         — currently active NWS alerts for SC/GA/NC
- data/raw/weather/hurricane_track_debby.geojson  — hand-curated Debby track (per plan)
- data/raw/weather/hurricane_track_idalia.geojson — hand-curated Idalia track

Idempotent: skips a file if present unless --force.
"""

from __future__ import annotations

import asyncio
import json
from datetime import date
from pathlib import Path

import typer

from sgw_platform.adapters.coops import CoopsObservationAdapter
from sgw_platform.adapters.nws import NwsAlertAdapter
from sgw_platform.observability.logging import configure_logging, get_logger

configure_logging()
log = get_logger("pull_fixtures")

app = typer.Typer(add_completion=False)

# Charleston Harbor 8665530 — per assumption A5.
CHARLESTON_LAT = 32.7818
CHARLESTON_LNG = -79.9250

# Debby: landfall Big Bend FL 2024-08-05; heavy impact SC coast Aug 06–08
DEBBY_WINDOW = (date(2024, 8, 3), date(2024, 8, 9))
# Idalia: landfall Big Bend FL 2023-08-30; near-record surge Charleston Aug 30
IDALIA_WINDOW = (date(2023, 8, 28), date(2023, 9, 1))

STATES = ["SC", "GA", "NC"]

# Hand-curated tracks — approximate landfall paths for demo credibility.
# In production these come from parsed NHC forecast cone shapefiles per advisory.
DEBBY_TRACK: dict = {
    "type": "FeatureCollection",
    "properties": {
        "storm_id": "AL042024",
        "storm_name": "Debby",
        "advisory_number": 15,
        "issued_at": "2024-08-05T15:00:00+00:00",
        "source": "hand_curated_from_public_records",
    },
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-83.5, 25.0],  # Gulf of Mexico
                    [-84.0, 27.5],  # approaching FL Big Bend
                    [-83.4, 29.6],  # FL landfall
                    [-82.5, 31.0],  # tracking N over GA
                    [-81.5, 32.0],  # SE GA
                    [-80.2, 32.7],  # SC coast (near Charleston)
                    [-78.5, 34.0],  # exit into Atlantic off NC
                ],
            },
            "properties": {"kind": "best_track"},
        },
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-84.5, 24.5],
                        [-82.5, 24.5],
                        [-80.0, 32.0],
                        [-78.0, 34.0],
                        [-76.0, 35.5],
                        [-77.5, 35.8],
                        [-79.5, 33.0],
                        [-82.0, 30.0],
                        [-84.5, 28.0],
                        [-84.5, 24.5],
                    ]
                ],
            },
            "properties": {"kind": "forecast_cone"},
        },
    ],
}

IDALIA_TRACK: dict = {
    "type": "FeatureCollection",
    "properties": {
        "storm_id": "AL102023",
        "storm_name": "Idalia",
        "advisory_number": 12,
        "issued_at": "2023-08-30T09:00:00+00:00",
        "source": "hand_curated_from_public_records",
    },
    "features": [
        {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [-84.5, 25.0],
                    [-84.0, 27.0],
                    [-83.4, 29.9],  # FL Big Bend landfall as Cat 3
                    [-82.5, 31.2],  # inland GA
                    [-81.5, 32.5],  # SC
                    [-79.9, 32.8],  # near Charleston
                    [-77.5, 34.5],  # exit to Atlantic
                ],
            },
            "properties": {"kind": "best_track"},
        },
        {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-85.0, 24.5],
                        [-83.0, 24.5],
                        [-80.0, 32.0],
                        [-77.5, 34.0],
                        [-75.5, 35.5],
                        [-77.0, 35.7],
                        [-79.0, 33.0],
                        [-82.0, 30.0],
                        [-85.0, 27.5],
                        [-85.0, 24.5],
                    ]
                ],
            },
            "properties": {"kind": "forecast_cone"},
        },
    ],
}


async def _pull_coops(out_path: Path, begin: date, end: date, force: bool) -> None:
    if out_path.exists() and not force:
        log.info("fixture.skip", path=str(out_path))
        return
    adapter = CoopsObservationAdapter("8665530", CHARLESTON_LAT, CHARLESTON_LNG)
    obs = await adapter.fetch_water_level(begin, end)
    payload = {
        "source": "NOS_COOPS",
        "station_id": "8665530",
        "station_name": "Charleston, Cooper River Entrance",
        "latitude": CHARLESTON_LAT,
        "longitude": CHARLESTON_LNG,
        "window": {"begin": begin.isoformat(), "end": end.isoformat()},
        "count": len(obs),
        "observations": [o.model_dump(mode="json") for o in obs],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, default=str))
    log.info("fixture.written", path=str(out_path), count=len(obs))


async def _pull_alerts(out_path: Path, force: bool) -> None:
    if out_path.exists() and not force:
        log.info("fixture.skip", path=str(out_path))
        return
    adapter = NwsAlertAdapter()
    alerts = await adapter.fetch_active(STATES)
    payload = {
        "source": "NWS_alerts_active",
        "states": STATES,
        "count": len(alerts),
        "alerts": [a.model_dump(mode="json") for a in alerts],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2, default=str))
    log.info("fixture.written", path=str(out_path), count=len(alerts))


def _write_track(out_path: Path, track: dict, force: bool) -> None:
    if out_path.exists() and not force:
        log.info("fixture.skip", path=str(out_path))
        return
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(track, indent=2))
    log.info("fixture.written", path=str(out_path))


@app.command()
def main(
    data_dir: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data",
        help="Data root (contains raw/, reference/, curated/)",
    ),
    force: bool = typer.Option(False, help="Overwrite existing fixtures"),
) -> None:
    weather_dir = data_dir / "raw" / "weather"
    weather_dir.mkdir(parents=True, exist_ok=True)

    async def _run() -> None:
        await _pull_coops(weather_dir / "coops_charleston_debby.json", *DEBBY_WINDOW, force)
        await _pull_coops(weather_dir / "coops_charleston_idalia.json", *IDALIA_WINDOW, force)
        await _pull_alerts(weather_dir / "nws_alerts_sample.json", force)
        _write_track(weather_dir / "hurricane_track_debby.geojson", DEBBY_TRACK, force)
        _write_track(weather_dir / "hurricane_track_idalia.geojson", IDALIA_TRACK, force)

    asyncio.run(_run())


if __name__ == "__main__":
    app()
