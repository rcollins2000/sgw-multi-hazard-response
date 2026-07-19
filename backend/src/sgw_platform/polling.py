"""Background pollers for live NOAA feeds.

Two async tasks that keep Postgres in sync with the upstream sources so the
frontend cockpit reflects the real world without a build-time snapshot:

  - ``poll_nws_alerts``      — NWS active alerts for SC/GA/NC, every 60s
  - ``poll_coops_water_level`` — NOS CO-OPS gauge 8665530 water levels, every 6 min

Both start in the FastAPI lifespan alongside model training (see
``sgw_platform.api.main``). Each loop is failure-tolerant: an error on one
cycle records itself in ``POLLERS.<feed>.last_error`` and the loop keeps
running so a transient upstream 5xx doesn't take the platform down.

Freshness is exposed via ``/api/status`` and ``/api/data-sources`` — that
way the frontend's Data Sources popover can render "LIVE · last update N
seconds ago" instead of the previous build-time snapshot label.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.adapters.coops import CoopsObservationAdapter
from sgw_platform.adapters.nws import NwsAlertAdapter
from sgw_platform.db.models import WeatherObservation
from sgw_platform.observability.logging import get_logger

log = get_logger("polling")

# ---- configuration -----------------------------------------------------------

ALERT_STATES: list[str] = ["SC", "GA", "NC"]

# Charleston Harbor 8665530 — assumption A5 anchor gauge (see docs/01_assumptions.md).
COOPS_STATION = "8665530"
COOPS_LAT = 32.7818
COOPS_LON = -79.9250
COOPS_LIVE_SOURCE = "NOS_COOPS:live_8665530"

NWS_INTERVAL_S = 60      # 1 minute — the NWS feed itself refreshes on issue
COOPS_INTERVAL_S = 360   # 6 minutes — CO-OPS water-level cadence upstream

# Rolling window for the live water-level buffer. 48h gives Prophet enough
# history to fit tides + surge; anything older is left to the archived sources.
COOPS_WINDOW_HOURS = 48

# Session factory type — the app passes ``session_scope`` itself.
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# ---- freshness state ---------------------------------------------------------


class PollerState:
    """Small dashboard-visible state for one poller."""

    def __init__(self, cadence_s: int) -> None:
        self.cadence_s: int = cadence_s
        self.last_success: datetime | None = None
        self.last_error: str | None = None
        self.cycle_count: int = 0
        self.last_row_count: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "cadence_seconds": self.cadence_s,
            "last_success": self.last_success.isoformat() if self.last_success else None,
            "last_error": self.last_error,
            "cycle_count": self.cycle_count,
            "last_row_count": self.last_row_count,
        }


class Pollers:
    """Registry — read by ``/api/status`` and ``/api/data-sources``."""

    def __init__(self) -> None:
        self.nws_alerts = PollerState(cadence_s=NWS_INTERVAL_S)
        self.coops_water = PollerState(cadence_s=COOPS_INTERVAL_S)

    def as_dict(self) -> dict[str, Any]:
        return {
            "nws_alerts": self.nws_alerts.as_dict(),
            "coops_water": self.coops_water.as_dict(),
        }


POLLERS = Pollers()

# ---- one-shot poll implementations ------------------------------------------


async def _poll_nws_once(session_factory: SessionFactory) -> int:
    """Fetch active NWS alerts for SC/GA/NC and upsert into ``weather_alerts``.

    Uses ON CONFLICT (alert_id) DO UPDATE so re-issuing the same alert (which
    NWS does when severity or expiry changes) overwrites in place. Alerts that
    expired more than 24h ago are swept so the table doesn't grow unbounded.
    """
    adapter = NwsAlertAdapter()
    alerts = await adapter.fetch_active(ALERT_STATES)
    async with session_factory() as session:
        for a in alerts:
            await session.execute(
                text(
                    """
                    INSERT INTO weather_alerts
                        (alert_id, hazard_type, severity, urgency, issued_at, expires_at,
                         headline, payload, source)
                    VALUES (:alert_id, :hazard_type, :severity, :urgency,
                            :issued_at, :expires_at, :headline,
                            CAST(:payload AS JSONB), :source)
                    ON CONFLICT (alert_id) DO UPDATE SET
                        hazard_type = EXCLUDED.hazard_type,
                        severity    = EXCLUDED.severity,
                        urgency     = EXCLUDED.urgency,
                        expires_at  = EXCLUDED.expires_at,
                        headline    = EXCLUDED.headline,
                        payload     = EXCLUDED.payload,
                        source      = EXCLUDED.source
                    """
                ),
                {
                    "alert_id": a.alert_id,
                    "hazard_type": a.hazard_type,
                    "severity": a.severity,
                    "urgency": a.urgency,
                    "issued_at": a.issued_at,
                    "expires_at": a.expires_at,
                    "headline": a.headline[:2000],
                    "payload": json.dumps(a.raw),
                    "source": "NWS_alerts_live",
                },
            )
        # sweep long-expired alerts — cheap since expires_at is indexed
        await session.execute(
            text("DELETE FROM weather_alerts WHERE expires_at < NOW() - INTERVAL '24 hours'")
        )
    return len(alerts)


async def _poll_coops_once(session_factory: SessionFactory) -> int:
    """Fetch the last ``COOPS_WINDOW_HOURS`` of water levels for gauge 8665530.

    The live buffer is fully replaced each cycle — safer than delta-inserts
    because CO-OPS occasionally backfills late observations. Archived Debby/
    Idalia windows are untouched (they use different ``source`` values).
    """
    adapter = CoopsObservationAdapter(COOPS_STATION, COOPS_LAT, COOPS_LON)
    end = datetime.now(UTC).date()
    begin = end - timedelta(days=COOPS_WINDOW_HOURS // 24 or 1)
    obs = await adapter.fetch_water_level(begin, end)
    if not obs:
        return 0
    async with session_factory() as session:
        await session.execute(
            text("DELETE FROM weather_observations WHERE source = :s"),
            {"s": COOPS_LIVE_SOURCE},
        )
        for o in obs:
            session.add(
                WeatherObservation(
                    observation_time=o.observation_time,
                    station_id=o.station_id,
                    latitude=o.latitude,
                    longitude=o.longitude,
                    water_level_ft=o.water_level_ft,
                    source=COOPS_LIVE_SOURCE,
                )
            )
    return len(obs)


# ---- loop driver -------------------------------------------------------------


async def _run_forever(
    name: str,
    state: PollerState,
    interval_s: int,
    fn: Callable[[SessionFactory], AsyncIterator[int]],  # type: ignore[type-arg]
    session_factory: SessionFactory,
) -> None:
    """Call ``fn`` immediately then every ``interval_s`` seconds forever.

    Errors are recorded in ``state.last_error`` and logged but never propagate
    — a poller that dies silently would be worse than one that reports "0
    successful cycles" via ``/api/status``.
    """
    while True:
        try:
            n = await fn(session_factory)  # type: ignore[misc]
            state.last_success = datetime.now(UTC)
            state.last_error = None
            state.last_row_count = n
            log.info("polling.ok", name=name, n=n)
        except Exception as exc:
            state.last_error = f"{type(exc).__name__}: {exc}"
            log.warning("polling.error", name=name, error=state.last_error)
        state.cycle_count += 1
        await asyncio.sleep(interval_s)


def start_pollers(session_factory: SessionFactory) -> list[asyncio.Task[None]]:
    """Kick off the background polling tasks. Returns handles for the caller
    to retain (prevents premature GC) — the lifespan holds these in a set."""
    return [
        asyncio.create_task(
            _run_forever(
                "nws_alerts",
                POLLERS.nws_alerts,
                NWS_INTERVAL_S,
                _poll_nws_once,  # type: ignore[arg-type]
                session_factory,
            )
        ),
        asyncio.create_task(
            _run_forever(
                "coops_water",
                POLLERS.coops_water,
                COOPS_INTERVAL_S,
                _poll_coops_once,  # type: ignore[arg-type]
                session_factory,
            )
        ),
    ]
