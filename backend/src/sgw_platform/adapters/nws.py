"""NWS API adapters — alerts, forecasts, observations.

Endpoint: https://api.weather.gov
No auth; User-Agent header required.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import httpx
from pydantic import BaseModel

BASE_URL = "https://api.weather.gov"
USER_AGENT = "SGW-Platform/0.1 (dev; https://example.local)"


class NwsAlert(BaseModel):
    alert_id: str
    hazard_type: str
    severity: str
    urgency: str
    issued_at: datetime
    expires_at: datetime
    headline: str
    affected_regions: list[str]
    raw: dict[str, Any]


class NwsForecast(BaseModel):
    forecast_id: str
    issued_at: datetime
    valid_from: datetime
    valid_to: datetime
    region: str
    forecast_horizon_hours: int
    payload: dict[str, Any]


class NwsObservation(BaseModel):
    observation_time: datetime
    station_id: str
    latitude: float
    longitude: float
    temperature_f: float | None = None
    wind_speed_mph: float | None = None
    wind_gust_mph: float | None = None
    quality: str = "Valid"


def _normalise_hazard_type(event: str) -> str:
    """Map free-text NWS event names → our internal hazard-type enum."""
    e = event.lower()
    if any(w in e for w in ("hurricane", "tropical")):
        return "hurricane"
    if any(w in e for w in ("flood", "flash flood", "coastal flood")):
        return "flood"
    if any(w in e for w in ("heat", "excessive heat")):
        return "heatwave"
    if any(w in e for w in ("fire", "red flag")):
        return "wildfire"
    return "other"


class NwsAlertAdapter:
    """Fetches active NWS alerts for one or more US states."""

    def __init__(self, user_agent: str = USER_AGENT) -> None:
        self.user_agent = user_agent

    async def fetch_active(self, state_codes: list[str]) -> list[NwsAlert]:
        alerts: list[NwsAlert] = []
        async with httpx.AsyncClient(
            timeout=30, headers={"User-Agent": self.user_agent, "Accept": "application/geo+json"}
        ) as client:
            for state in state_codes:
                response = await client.get(f"{BASE_URL}/alerts/active", params={"area": state})
                response.raise_for_status()
                for feat in response.json().get("features", []):
                    props = feat["properties"]
                    alert_id = props.get("id") or feat.get("id") or ""
                    event = props.get("event") or ""
                    if not alert_id:
                        continue
                    alerts.append(
                        NwsAlert(
                            alert_id=alert_id,
                            hazard_type=_normalise_hazard_type(event),
                            severity=(props.get("severity") or "Unknown").lower(),
                            urgency=(props.get("urgency") or "Unknown").lower(),
                            issued_at=datetime.fromisoformat(props["sent"]),
                            expires_at=datetime.fromisoformat(
                                props.get("expires") or props.get("ends") or props["sent"]
                            ),
                            headline=props.get("headline") or event,
                            affected_regions=[state],
                            raw={"properties": props},
                        )
                    )
        return alerts


class NwsForecastAdapter:
    """Fetches gridded forecasts for a (lat, lng)."""

    def __init__(self, user_agent: str = USER_AGENT) -> None:
        self.user_agent = user_agent

    async def fetch(self, latitude: float, longitude: float, region: str) -> NwsForecast:
        async with httpx.AsyncClient(
            timeout=30, headers={"User-Agent": self.user_agent, "Accept": "application/geo+json"}
        ) as client:
            point = await client.get(f"{BASE_URL}/points/{latitude:.4f},{longitude:.4f}")
            point.raise_for_status()
            forecast_url = point.json()["properties"]["forecast"]

            fc = await client.get(forecast_url)
            fc.raise_for_status()
            payload = fc.json()

        props = payload["properties"]
        periods = props.get("periods") or []
        first = periods[0] if periods else {}
        last = periods[-1] if periods else {}
        return NwsForecast(
            forecast_id=f"NWS-{latitude:.2f},{longitude:.2f}-{props['updated']}",
            issued_at=datetime.fromisoformat(props["updated"]),
            valid_from=datetime.fromisoformat(first.get("startTime", props["updated"])),
            valid_to=datetime.fromisoformat(last.get("endTime", props["updated"])),
            region=region,
            forecast_horizon_hours=len(periods),
            payload=props,
        )


class NwsObservationAdapter:
    """Fetches recent observations from an NWS station."""

    def __init__(self, user_agent: str = USER_AGENT) -> None:
        self.user_agent = user_agent

    async def fetch_latest(self, station_id: str) -> NwsObservation | None:
        async with httpx.AsyncClient(
            timeout=30, headers={"User-Agent": self.user_agent, "Accept": "application/geo+json"}
        ) as client:
            response = await client.get(f"{BASE_URL}/stations/{station_id}/observations/latest")
            if response.status_code == 404:
                return None
            response.raise_for_status()
            feat = response.json()

        p = feat["properties"]
        geom = feat["geometry"]
        temp_c = (p.get("temperature") or {}).get("value")
        temp_f = (temp_c * 9 / 5 + 32) if temp_c is not None else None
        wind_kmh = (p.get("windSpeed") or {}).get("value")
        wind_mph = (wind_kmh * 0.621371) if wind_kmh is not None else None
        gust_kmh = (p.get("windGust") or {}).get("value")
        gust_mph = (gust_kmh * 0.621371) if gust_kmh is not None else None
        return NwsObservation(
            observation_time=datetime.fromisoformat(p["timestamp"]),
            station_id=station_id,
            latitude=geom["coordinates"][1],
            longitude=geom["coordinates"][0],
            temperature_f=temp_f,
            wind_speed_mph=wind_mph,
            wind_gust_mph=gust_mph,
        )
