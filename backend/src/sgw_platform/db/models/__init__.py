"""SQLAlchemy models — imported here so Alembic autogenerate sees them all."""

from sgw_platform.db.models.assets import Asset, HazardZone, Region, ServiceArea
from sgw_platform.db.models.audit import (
    AuditLog,
    ModelVersion,
    OperatorDecision,
    Prediction,
)
from sgw_platform.db.models.field import Crew, CrewStatus, FieldReport
from sgw_platform.db.models.graph import AssetDependency, AssetIdCrosswalk
from sgw_platform.db.models.maintenance import InspectionHistory, WorkOrder
from sgw_platform.db.models.operations import Incident, Outage, SensorReading
from sgw_platform.db.models.weather import (
    HurricaneTrack,
    WeatherAlert,
    WeatherForecast,
    WeatherObservation,
)

__all__ = [
    "Asset",
    "AssetDependency",
    "AssetIdCrosswalk",
    "AuditLog",
    "Crew",
    "CrewStatus",
    "FieldReport",
    "HazardZone",
    "HurricaneTrack",
    "Incident",
    "InspectionHistory",
    "ModelVersion",
    "OperatorDecision",
    "Outage",
    "Prediction",
    "Region",
    "SensorReading",
    "ServiceArea",
    "WeatherAlert",
    "WeatherForecast",
    "WeatherObservation",
    "WorkOrder",
]
