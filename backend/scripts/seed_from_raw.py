"""Load raw mock files into Postgres.

Idempotent: TRUNCATEs the platform tables (in FK-safe order) before insertion.
Preserves quality flags + source metadata as per data-model spec.

Usage:
    python -m scripts.seed_from_raw [--data-dir DIR]
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, time
from pathlib import Path

import pandas as pd
import typer
from geoalchemy2.shape import from_shape
from shapely.geometry import Point, Polygon, shape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.db.models import (
    Asset,
    AssetDependency,
    AssetIdCrosswalk,
    Crew,
    CrewStatus,
    FieldReport,
    HazardZone,
    Incident,
    InspectionHistory,
    Outage,
    Region,
    SensorReading,
    ServiceArea,
    WorkOrder,
)
from sgw_platform.db.session import session_scope
from sgw_platform.observability.logging import configure_logging, get_logger

configure_logging()
log = get_logger("seed")

app = typer.Typer(add_completion=False)


TRUNCATE_ORDER = [
    "sensor_readings",
    "crew_status",
    "field_reports",
    "outages",
    "incidents",
    "asset_id_crosswalk",
    "asset_dependencies",
    "inspection_history",
    "work_orders",
    "crews",
    "hazard_zones",
    "service_areas",
    "assets",
    "regions",
]


async def truncate_all(session: AsyncSession) -> None:
    tables = ", ".join(TRUNCATE_ORDER)
    await session.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE;"))


def _geojson_features(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    return payload["features"]


async def load_regions(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "reference" / "regions.csv")
    for _, row in df.iterrows():
        session.add(Region(region_id=row["region_id"], name=row["name"], state_code=row["state_code"]))
    await session.flush()
    return len(df)


async def load_assets(session: AsyncSession, data_dir: Path) -> int:
    features = _geojson_features(data_dir / "raw" / "gis" / "assets.geojson")
    for feat in features:
        p = feat["properties"]
        geom = Point(feat["geometry"]["coordinates"])
        last_insp = p.get("last_inspection_date")
        session.add(
            Asset(
                asset_id=p["asset_id"],
                asset_name=p["asset_name"],
                asset_type=p["asset_type"],
                utility_domain=p["utility_domain"],
                region=p["region"],
                geom=from_shape(geom, srid=4326),
                operational_status=p.get("operational_status", "operational"),
                criticality_rating=p["criticality_rating"],
                condition_score=p.get("condition_score"),
                commissioned_year=p.get("commissioned_year"),
                design_capacity=p.get("design_capacity"),
                capacity_unit=p.get("capacity_unit"),
                service_population=p.get("service_population"),
                flood_zone=p.get("flood_zone"),
                ground_elevation_ft=p.get("ground_elevation_ft"),
                backup_power=p.get("backup_power"),
                last_inspection_date=datetime.fromisoformat(last_insp).date() if last_insp else None,
            )
        )
    await session.flush()
    return len(features)


async def load_service_areas(session: AsyncSession, data_dir: Path) -> int:
    features = _geojson_features(data_dir / "raw" / "gis" / "service_areas.geojson")
    for feat in features:
        p = feat["properties"]
        geom = Polygon(feat["geometry"]["coordinates"][0])
        session.add(
            ServiceArea(
                service_area_id=p["service_area_id"],
                service_area_name=p["service_area_name"],
                geom=from_shape(geom, srid=4326),
                population=p["population"],
                priority_facilities=p["priority_facilities"],
                hospitals=p["hospitals"],
                emergency_shelters=p["emergency_shelters"],
                primary_asset_id=p["primary_asset_id"],
            )
        )
    await session.flush()
    return len(features)


async def load_hazard_zones(session: AsyncSession, data_dir: Path) -> int:
    features = _geojson_features(data_dir / "raw" / "gis" / "hazard_zones.geojson")
    for feat in features:
        p = feat["properties"]
        geom = shape(feat["geometry"])  # MultiPolygon
        session.add(
            HazardZone(
                hazard_zone_id=p["hazard_zone_id"],
                hazard_type=p["hazard_type"],
                severity_band=p.get("severity_band"),
                source=p["source"],
                geom=from_shape(geom, srid=4326),
            )
        )
    await session.flush()
    return len(features)


async def load_crosswalk(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "reference" / "asset_id_crosswalk.csv")
    for _, row in df.iterrows():
        session.add(
            AssetIdCrosswalk(
                canonical_asset_id=row["canonical_asset_id"],
                gis_id=row.get("gis_id"),
                maintenance_id=row.get("maintenance_id"),
                scada_id=row.get("scada_id"),
                field_ops_id=row.get("field_ops_id"),
            )
        )
    await session.flush()
    return len(df)


async def load_dependencies(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "reference" / "asset_dependencies.csv")
    for _, row in df.iterrows():
        session.add(
            AssetDependency(
                upstream_asset_id=row["upstream_asset_id"],
                downstream_asset_id=row["downstream_asset_id"],
                dependency_type=row["dependency_type"],
                consequence_if_lost=row.get("consequence_if_lost"),
            )
        )
    await session.flush()
    return len(df)


async def load_work_orders(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "maintenance" / "work_orders.csv")
    for _, row in df.iterrows():
        session.add(
            WorkOrder(
                work_order_id=row["work_order_id"],
                asset_id=row["asset_id"],
                work_type=row["work_type"],
                description=row["description"],
                priority=row["priority"],
                status=row["status"],
                created_at_source=datetime.fromisoformat(row["created_at_source"]),
                due_date=datetime.fromisoformat(row["due_date"]).date() if pd.notna(row["due_date"]) else None,
                estimated_hours=row.get("estimated_hours"),
                assigned_team=row["assigned_team"] if pd.notna(row["assigned_team"]) else None,
            )
        )
    await session.flush()
    return len(df)


async def load_inspections(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "maintenance" / "inspection_history.csv")
    for _, row in df.iterrows():
        session.add(
            InspectionHistory(
                inspection_id=row["inspection_id"],
                asset_id=row["asset_id"],
                inspected_at=datetime.fromisoformat(row["inspected_at"]).date(),
                inspection_type=row["inspection_type"],
                condition_score=int(row["condition_score"]),
                defect_found=bool(row["defect_found"]),
                severity=row["severity"] if pd.notna(row["severity"]) else None,
                notes=row.get("notes"),
            )
        )
    await session.flush()
    return len(df)


async def load_crews(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "field_operations" / "crews.csv")
    for _, row in df.iterrows():
        session.add(
            Crew(
                crew_id=row["crew_id"],
                crew_name=row["crew_name"],
                base_region=row["base_region"],
                capability=row["capability"],
                shift_start=time.fromisoformat(row["shift_start"]),
                shift_end=time.fromisoformat(row["shift_end"]),
            )
        )
    await session.flush()
    return len(df)


async def load_crew_status(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "field_operations" / "crew_status.csv")
    for _, row in df.iterrows():
        session.add(
            CrewStatus(
                timestamp=datetime.fromisoformat(row["timestamp"]),
                crew_id=row["crew_id"],
                status=row["status"],
                latitude=row["latitude"],
                longitude=row["longitude"],
                current_job_id=row["current_job_id"] if pd.notna(row["current_job_id"]) else None,
                travel_time_min=int(row["travel_time_min"]) if pd.notna(row["travel_time_min"]) else None,
            )
        )
    await session.flush()
    return len(df)


async def load_field_reports(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "field_operations" / "field_reports.csv")
    for _, row in df.iterrows():
        session.add(
            FieldReport(
                report_id=row["report_id"],
                asset_id=row["asset_id"],
                crew_id=row["crew_id"],
                submitted_at=datetime.fromisoformat(row["submitted_at"]),
                observation_type=row["observation_type"],
                severity=row["severity"],
                access_status=row["access_status"],
                notes=row.get("notes"),
                photo_reference=row.get("photo_reference"),
            )
        )
    await session.flush()
    return len(df)


async def load_incidents(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "operations" / "incidents.csv")
    for _, row in df.iterrows():
        session.add(
            Incident(
                incident_id=row["incident_id"],
                opened_at=datetime.fromisoformat(row["opened_at"]),
                incident_type=row["incident_type"],
                region=row["region"],
                primary_asset_id=row["primary_asset_id"],
                severity=row["severity"],
                status=row["status"],
                people_affected=int(row["people_affected"]),
                lead_team=row["lead_team"] if pd.notna(row["lead_team"]) else None,
                resolved_at=datetime.fromisoformat(row["resolved_at"]) if pd.notna(row["resolved_at"]) else None,
                related_asset_ids=json.loads(row["related_asset_ids"]) if pd.notna(row["related_asset_ids"]) else None,
            )
        )
    await session.flush()
    return len(df)


async def load_outages(session: AsyncSession, data_dir: Path) -> int:
    df = pd.read_csv(data_dir / "raw" / "operations" / "outages.csv")
    for _, row in df.iterrows():
        session.add(
            Outage(
                outage_id=row["outage_id"],
                incident_id=row["incident_id"] if pd.notna(row["incident_id"]) else None,
                asset_id=row["asset_id"],
                started_at=datetime.fromisoformat(row["started_at"]),
                restored_at=datetime.fromisoformat(row["restored_at"]) if pd.notna(row["restored_at"]) else None,
                customers_affected=int(row["customers_affected"]),
                cause=row["cause"] if pd.notna(row["cause"]) else None,
            )
        )
    await session.flush()
    return len(df)


async def load_sensor_readings(session: AsyncSession, data_dir: Path) -> int:
    """Bulk insert with COPY-style speedup: use `add_all` in chunks."""
    df = pd.read_csv(data_dir / "raw" / "operations" / "sensor_readings.csv")
    chunk = 5000
    for i in range(0, len(df), chunk):
        batch = [
            SensorReading(
                timestamp=datetime.fromisoformat(row["timestamp"]),
                sensor_id=row["sensor_id"],
                asset_id=row["asset_id"],
                metric=row["metric"],
                value=row["value"],
                unit=row["unit"],
                quality_flag=row["quality_flag"],
            )
            for _, row in df.iloc[i : i + chunk].iterrows()
        ]
        session.add_all(batch)
        await session.flush()
    return len(df)


async def refresh_matview(session: AsyncSession) -> None:
    await session.execute(text("REFRESH MATERIALIZED VIEW operational_risk_snapshot;"))


async def _run(data_dir: Path) -> None:
    async with session_scope() as session:
        log.info("seed.begin", data_dir=str(data_dir))
        await truncate_all(session)

        regions_n = await load_regions(session, data_dir)
        assets_n = await load_assets(session, data_dir)
        sa_n = await load_service_areas(session, data_dir)
        hz_n = await load_hazard_zones(session, data_dir)
        xw_n = await load_crosswalk(session, data_dir)
        dep_n = await load_dependencies(session, data_dir)
        wo_n = await load_work_orders(session, data_dir)
        insp_n = await load_inspections(session, data_dir)
        crews_n = await load_crews(session, data_dir)
        cs_n = await load_crew_status(session, data_dir)
        fr_n = await load_field_reports(session, data_dir)
        inc_n = await load_incidents(session, data_dir)
        out_n = await load_outages(session, data_dir)
        sr_n = await load_sensor_readings(session, data_dir)

        await refresh_matview(session)

        log.info(
            "seed.done",
            regions=regions_n,
            assets=assets_n,
            service_areas=sa_n,
            hazard_zones=hz_n,
            crosswalk=xw_n,
            dependencies=dep_n,
            work_orders=wo_n,
            inspections=insp_n,
            crews=crews_n,
            crew_status=cs_n,
            field_reports=fr_n,
            incidents=inc_n,
            outages=out_n,
            sensor_readings=sr_n,
        )


@app.command()
def main(
    data_dir: Path = typer.Option(
        Path(__file__).resolve().parents[2] / "data",
        help="Data root (contains raw/ and reference/)",
    ),
) -> None:
    """Truncate and re-seed the operational tables from raw files."""
    asyncio.run(_run(data_dir.resolve()))


if __name__ == "__main__":
    app()
