"""NOS CO-OPS tides & currents adapter — real observed water levels at NOAA gauges.

Endpoint: https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
No auth required. Anchor gauge: Charleston Harbor (8665530).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx
from pydantic import BaseModel

BASE_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
APPLICATION = "SGW-Platform"


class CoopsObservation(BaseModel):
    """Canonical schema — one observation from a CO-OPS gauge."""

    observation_time: datetime
    station_id: str
    latitude: float
    longitude: float
    water_level_ft: float | None = None
    quality: str = "Valid"


class CoopsObservationAdapter:
    """Fetches water-level observations from a CO-OPS station."""

    def __init__(self, station_id: str, latitude: float, longitude: float) -> None:
        self.station_id = station_id
        self.latitude = latitude
        self.longitude = longitude

    async def fetch_water_level(
        self,
        begin: date,
        end: date,
        *,
        datum: str = "MLLW",
        units: str = "english",
    ) -> list[CoopsObservation]:
        params: dict[str, Any] = {
            "product": "water_level",
            "application": APPLICATION,
            "station": self.station_id,
            "begin_date": begin.strftime("%Y%m%d"),
            "end_date": end.strftime("%Y%m%d"),
            "datum": datum,
            "time_zone": "gmt",
            "units": units,
            "format": "json",
        }
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(BASE_URL, params=params)
            response.raise_for_status()
            payload = response.json()

        if "error" in payload:
            raise RuntimeError(f"CO-OPS error for station {self.station_id}: {payload['error']}")

        obs: list[CoopsObservation] = []
        for row in payload.get("data", []):
            try:
                value = float(row["v"]) if row.get("v") else None
            except (TypeError, ValueError):
                value = None
            obs.append(
                CoopsObservation(
                    observation_time=datetime.fromisoformat(row["t"].replace(" ", "T") + "+00:00"),
                    station_id=self.station_id,
                    latitude=self.latitude,
                    longitude=self.longitude,
                    water_level_ft=value,
                    quality="Valid" if not row.get("f", "").startswith("1") else "Warning",
                )
            )
        return obs
