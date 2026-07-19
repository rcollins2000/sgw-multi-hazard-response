"""NHC hurricane track adapter.

MVP scope: reads hand-curated best-track GeoJSON fixtures (Debby 2024, Idalia 2023)
built from publicly-known landfall paths. Phase 2 upgrade: parse live NHC forecast
cone shapefiles (nhc.noaa.gov/gis) as they issue during active advisories.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel


class HurricaneTrackFeature(BaseModel):
    storm_id: str
    storm_name: str
    advisory_number: int
    issued_at: datetime
    cone_coordinates: list[list[float]]  # single polygon ring
    track_coordinates: list[list[float]]  # linestring
    source: str = "NHC-hand-curated-MVP"


class NhcTrackAdapter:
    """Loads hurricane track fixtures from disk."""

    def __init__(self, fixture_dir: Path) -> None:
        self.fixture_dir = fixture_dir

    def load(self, storm_id: str) -> HurricaneTrackFeature | None:
        path = self.fixture_dir / f"hurricane_track_{storm_id.lower()}.geojson"
        if not path.exists():
            return None
        payload: dict[str, Any] = json.loads(path.read_text())
        # Fixture format: FeatureCollection with two features (cone Polygon, track LineString)
        cone_coords: list[list[float]] = []
        track_coords: list[list[float]] = []
        meta = payload.get("properties", {}) or {}
        for feat in payload["features"]:
            geom = feat["geometry"]
            props = feat["properties"]
            if geom["type"] == "Polygon":
                cone_coords = geom["coordinates"][0]
            elif geom["type"] == "LineString":
                track_coords = geom["coordinates"]
            if not meta:
                meta = props

        return HurricaneTrackFeature(
            storm_id=meta.get("storm_id", storm_id),
            storm_name=meta.get("storm_name", storm_id.title()),
            advisory_number=int(meta.get("advisory_number", 1)),
            issued_at=datetime.fromisoformat(meta["issued_at"]),
            cone_coordinates=cone_coords,
            track_coordinates=track_coords,
            source=meta.get("source", "NHC-hand-curated-MVP"),
        )
