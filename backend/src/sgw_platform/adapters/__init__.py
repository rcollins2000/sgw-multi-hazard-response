"""Six-adapter Hazard Data family — isolates provider choice for portability."""

from sgw_platform.adapters.coops import CoopsObservation, CoopsObservationAdapter
from sgw_platform.adapters.nhc import HurricaneTrackFeature, NhcTrackAdapter
from sgw_platform.adapters.nws import (
    NwsAlert,
    NwsAlertAdapter,
    NwsForecast,
    NwsForecastAdapter,
    NwsObservation,
    NwsObservationAdapter,
)

__all__ = [
    "CoopsObservation",
    "CoopsObservationAdapter",
    "HurricaneTrackFeature",
    "NhcTrackAdapter",
    "NwsAlert",
    "NwsAlertAdapter",
    "NwsForecast",
    "NwsForecastAdapter",
    "NwsObservation",
    "NwsObservationAdapter",
]
