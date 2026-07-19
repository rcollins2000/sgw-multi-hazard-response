"""Operational schema — all tables, PostGIS geometry, partitioning, triggers, materialised view.

Revision ID: 002_ops
Revises: 001_postgis
Create Date: 2026-07-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "002_ops"
down_revision: str | None = "001_postgis"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- Regions --------------------------------------------------------
    op.create_table(
        "regions",
        sa.Column("region_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("state_code", sa.String(2), nullable=False),
        sa.Column("footprint", Geometry("MULTIPOLYGON", srid=4326), nullable=True),
    )

    # --- Assets ---------------------------------------------------------
    op.create_table(
        "assets",
        sa.Column("asset_id", sa.String(64), primary_key=True),
        sa.Column("asset_name", sa.String(256), nullable=False),
        sa.Column("asset_type", sa.String(64), nullable=False, index=True),
        sa.Column("utility_domain", sa.String(32), nullable=False, index=True),
        sa.Column("region", sa.String(64), nullable=False, index=True),
        sa.Column("geom", Geometry("GEOMETRY", srid=4326), nullable=False),
        sa.Column("operational_status", sa.String(32), nullable=False, server_default="operational"),
        sa.Column("criticality_rating", sa.Integer, nullable=False, server_default="3"),
        sa.Column("condition_score", sa.Integer, nullable=True),
        sa.Column("commissioned_year", sa.Integer, nullable=True),
        sa.Column("design_capacity", sa.Float, nullable=True),
        sa.Column("capacity_unit", sa.String(32), nullable=True),
        sa.Column("service_population", sa.Integer, nullable=True),
        sa.Column("flood_zone", sa.String(16), nullable=True),
        sa.Column("ground_elevation_ft", sa.Float, nullable=True),
        sa.Column("backup_power", sa.String(64), nullable=True),
        sa.Column("last_inspection_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("CREATE INDEX ix_assets_geom ON assets USING GIST (geom);")

    # --- Service areas --------------------------------------------------
    op.create_table(
        "service_areas",
        sa.Column("service_area_id", sa.String(64), primary_key=True),
        sa.Column("service_area_name", sa.String(256), nullable=False),
        sa.Column("geom", Geometry("POLYGON", srid=4326), nullable=False),
        sa.Column("population", sa.Integer, nullable=False, server_default="0"),
        sa.Column("priority_facilities", sa.Integer, nullable=False, server_default="0"),
        sa.Column("hospitals", sa.Integer, nullable=False, server_default="0"),
        sa.Column("emergency_shelters", sa.Integer, nullable=False, server_default="0"),
        sa.Column("primary_asset_id", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("CREATE INDEX ix_service_areas_geom ON service_areas USING GIST (geom);")

    # --- Hazard zones ---------------------------------------------------
    op.create_table(
        "hazard_zones",
        sa.Column("hazard_zone_id", sa.String(64), primary_key=True),
        sa.Column("hazard_type", sa.String(32), nullable=False, index=True),
        sa.Column("severity_band", sa.String(32), nullable=True),
        sa.Column("source", sa.String(128), nullable=False),
        sa.Column("geom", Geometry("MULTIPOLYGON", srid=4326), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.execute("CREATE INDEX ix_hazard_zones_geom ON hazard_zones USING GIST (geom);")

    # --- Work orders ----------------------------------------------------
    op.create_table(
        "work_orders",
        sa.Column("work_order_id", sa.String(64), primary_key=True),
        sa.Column("asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), index=True),
        sa.Column("work_type", sa.String(32), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("priority", sa.String(16), nullable=False, index=True),
        sa.Column("status", sa.String(32), nullable=False, index=True),
        sa.Column("created_at_source", sa.DateTime(timezone=True)),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("estimated_hours", sa.Float, nullable=True),
        sa.Column("assigned_team", sa.String(64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- Inspection history ---------------------------------------------
    op.create_table(
        "inspection_history",
        sa.Column("inspection_id", sa.String(64), primary_key=True),
        sa.Column("asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), index=True),
        sa.Column("inspected_at", sa.Date, nullable=False),
        sa.Column("inspection_type", sa.String(32), nullable=False),
        sa.Column("condition_score", sa.Integer, nullable=False),
        sa.Column("defect_found", sa.Boolean, nullable=False, server_default="false"),
        sa.Column("severity", sa.String(16), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- Sensor readings (PARTITIONED by month) -------------------------
    op.execute(
        """
        CREATE TABLE sensor_readings (
            timestamp   TIMESTAMPTZ NOT NULL,
            sensor_id   VARCHAR(64) NOT NULL,
            asset_id    VARCHAR(64) NOT NULL,
            metric      VARCHAR(64) NOT NULL,
            value       DOUBLE PRECISION NOT NULL,
            unit        VARCHAR(16) NOT NULL,
            quality_flag VARCHAR(16) NOT NULL,
            PRIMARY KEY (timestamp, sensor_id)
        ) PARTITION BY RANGE (timestamp);
        """
    )
    op.execute("CREATE INDEX ix_sensor_readings_asset ON sensor_readings (asset_id);")
    op.execute("CREATE INDEX ix_sensor_readings_quality ON sensor_readings (quality_flag);")

    # Create partitions for 2026-06 through 2026-12 + 2027-01 (adjust as needed)
    for year, month in [(2026, m) for m in range(6, 13)] + [(2027, 1)]:
        next_year = year + 1 if month == 12 else year
        next_month = 1 if month == 12 else month + 1
        op.execute(
            f"""
            CREATE TABLE sensor_readings_y{year}m{month:02d}
            PARTITION OF sensor_readings
            FOR VALUES FROM ('{year:04d}-{month:02d}-01') TO ('{next_year:04d}-{next_month:02d}-01');
            """
        )

    # --- Crews ----------------------------------------------------------
    op.create_table(
        "crews",
        sa.Column("crew_id", sa.String(64), primary_key=True),
        sa.Column("crew_name", sa.String(128), nullable=False),
        sa.Column("base_region", sa.String(64), nullable=False, index=True),
        sa.Column("capability", sa.String(128), nullable=False),
        sa.Column("shift_start", sa.Time, nullable=False),
        sa.Column("shift_end", sa.Time, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "crew_status",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("crew_id", sa.String(64), sa.ForeignKey("crews.crew_id"), index=True),
        sa.Column("status", sa.String(32), nullable=False, index=True),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("current_job_id", sa.String(64), nullable=True),
        sa.Column("travel_time_min", sa.Integer, nullable=True),
    )

    op.create_table(
        "field_reports",
        sa.Column("report_id", sa.String(64), primary_key=True),
        sa.Column("asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), index=True),
        sa.Column("crew_id", sa.String(64), sa.ForeignKey("crews.crew_id"), index=True),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("observation_type", sa.String(64), nullable=False),
        sa.Column("severity", sa.String(16), nullable=False, index=True),
        sa.Column("access_status", sa.String(32), nullable=False),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("photo_reference", sa.String(256), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- Incidents + outages --------------------------------------------
    op.create_table(
        "incidents",
        sa.Column("incident_id", sa.String(64), primary_key=True),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("incident_type", sa.String(64), nullable=False),
        sa.Column("region", sa.String(64), nullable=False, index=True),
        sa.Column("primary_asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), nullable=True, index=True),
        sa.Column("severity", sa.String(16), nullable=False, index=True),
        sa.Column("status", sa.String(32), nullable=False, index=True),
        sa.Column("people_affected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lead_team", sa.String(64), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_notes", sa.Text, nullable=True),
        sa.Column("related_asset_ids", JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "outages",
        sa.Column("outage_id", sa.String(64), primary_key=True),
        sa.Column("incident_id", sa.String(64), sa.ForeignKey("incidents.incident_id"), nullable=True, index=True),
        sa.Column("asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), index=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("restored_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("customers_affected", sa.Integer, nullable=False, server_default="0"),
        sa.Column("cause", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- Weather --------------------------------------------------------
    op.create_table(
        "weather_observations",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("observation_time", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("station_id", sa.String(64), nullable=False, index=True),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("rainfall_1h_in", sa.Float, nullable=True),
        sa.Column("rainfall_24h_in", sa.Float, nullable=True),
        sa.Column("wind_speed_mph", sa.Float, nullable=True),
        sa.Column("wind_gust_mph", sa.Float, nullable=True),
        sa.Column("temperature_f", sa.Float, nullable=True),
        sa.Column("river_level_ft", sa.Float, nullable=True),
        sa.Column("water_level_ft", sa.Float, nullable=True),
        sa.Column("source", sa.String(64), nullable=False),
    )

    op.create_table(
        "weather_forecasts",
        sa.Column("forecast_id", sa.String(64), primary_key=True),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to", sa.DateTime(timezone=True), nullable=False),
        sa.Column("region", sa.String(64), nullable=False, index=True),
        sa.Column("forecast_horizon_hours", sa.Integer, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
    )

    op.create_table(
        "weather_alerts",
        sa.Column("alert_id", sa.String(64), primary_key=True),
        sa.Column("hazard_type", sa.String(32), nullable=False, index=True),
        sa.Column("severity", sa.String(16), nullable=False, index=True),
        sa.Column("urgency", sa.String(16), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("headline", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("source", sa.String(64), nullable=False),
    )

    op.create_table(
        "hurricane_tracks",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("storm_id", sa.String(64), nullable=False, index=True),
        sa.Column("storm_name", sa.String(64), nullable=False),
        sa.Column("advisory_number", sa.Integer, nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("cone", Geometry("POLYGON", srid=4326), nullable=False),
        sa.Column("track_line", Geometry("LINESTRING", srid=4326), nullable=False),
        sa.Column("source", sa.String(64), nullable=False, server_default="NHC"),
    )
    op.execute("CREATE INDEX ix_hurricane_tracks_cone ON hurricane_tracks USING GIST (cone);")

    op.create_table(
        "historical_events",
        sa.Column("event_id", sa.String(64), primary_key=True),
        sa.Column("event_type", sa.String(64), nullable=False, index=True),
        sa.Column("state", sa.String(2), nullable=False, index=True),
        sa.Column("begin_date", sa.Date, nullable=False, index=True),
        sa.Column("end_date", sa.Date, nullable=False),
        sa.Column("damage_property_usd", sa.Float, nullable=True),
        sa.Column("damage_crops_usd", sa.Float, nullable=True),
        sa.Column("deaths_direct", sa.Integer, nullable=False, server_default="0"),
        sa.Column("injuries_direct", sa.Integer, nullable=False, server_default="0"),
        sa.Column("episode_narrative", sa.Text, nullable=True),
    )

    # --- Graph ----------------------------------------------------------
    op.create_table(
        "asset_dependencies",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("upstream_asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), nullable=False, index=True),
        sa.Column("downstream_asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), nullable=False, index=True),
        sa.Column("dependency_type", sa.String(64), nullable=False),
        sa.Column("consequence_if_lost", sa.String(512), nullable=True),
    )

    op.create_table(
        "asset_id_crosswalk",
        sa.Column("canonical_asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), primary_key=True),
        sa.Column("gis_id", sa.String(64), nullable=True, index=True),
        sa.Column("maintenance_id", sa.String(64), nullable=True, index=True),
        sa.Column("scada_id", sa.String(64), nullable=True, index=True),
        sa.Column("field_ops_id", sa.String(64), nullable=True, index=True),
    )

    # --- Audit / registry -----------------------------------------------
    op.create_table(
        "model_versions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("model_family", sa.String(64), nullable=False, index=True),
        sa.Column("version", sa.String(64), nullable=False),
        sa.Column("trained_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("metrics", JSONB, nullable=False),
        sa.Column("artefact_path", sa.String(256), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
    )

    op.create_table(
        "predictions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("asset_id", sa.String(64), sa.ForeignKey("assets.asset_id"), index=True),
        sa.Column("model_family", sa.String(64), nullable=False, index=True),
        sa.Column("model_version", sa.String(64), nullable=False),
        sa.Column("hazard_type", sa.String(32), nullable=True, index=True),
        sa.Column("score", sa.Float, nullable=False),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("features_hash", sa.String(64), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
    )

    op.create_table(
        "operator_decisions",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("prediction_id", sa.Integer, sa.ForeignKey("predictions.id"), nullable=True, index=True),
        sa.Column("user", sa.String(64), nullable=False, index=True),
        sa.Column("action", sa.String(16), nullable=False, index=True),
        sa.Column("reason", sa.Text, nullable=True),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("user", sa.String(64), nullable=False, index=True),
        sa.Column("action_type", sa.String(64), nullable=False, index=True),
        sa.Column("subject_id", sa.String(128), nullable=False, index=True),
        sa.Column("model_version", sa.String(64), nullable=True),
        sa.Column("prompt_version", sa.String(64), nullable=True),
        sa.Column("features_hash", sa.String(64), nullable=True),
        sa.Column("previous_hash", sa.String(64), nullable=True),
        sa.Column("current_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("payload", JSONB, nullable=False),
    )

    # --- Append-only triggers (block UPDATE/DELETE) ---------------------
    # Each statement executed separately — asyncpg doesn't support multi-statement queries.
    for table in ("audit_log", "predictions", "operator_decisions"):
        op.execute(
            f"""
            CREATE OR REPLACE FUNCTION {table}_append_only()
            RETURNS trigger AS $body$
            BEGIN
                RAISE EXCEPTION '{table} is append-only; % blocked', TG_OP;
            END;
            $body$ LANGUAGE plpgsql;
            """
        )
        op.execute(
            f"CREATE TRIGGER trg_{table}_no_update BEFORE UPDATE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {table}_append_only();"
        )
        op.execute(
            f"CREATE TRIGGER trg_{table}_no_delete BEFORE DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {table}_append_only();"
        )

    # --- Materialised view: operational_risk_snapshot -------------------
    op.execute(
        """
        CREATE MATERIALIZED VIEW operational_risk_snapshot AS
        SELECT
            a.asset_id,
            a.asset_name,
            a.asset_type,
            a.utility_domain,
            a.region,
            a.criticality_rating,
            a.condition_score,
            a.service_population,
            a.flood_zone,
            a.geom,
            (SELECT COUNT(*) FROM work_orders w
             WHERE w.asset_id = a.asset_id AND w.status IN ('Overdue', 'In progress')) AS open_work_orders,
            (SELECT MAX(wo.due_date) FROM work_orders wo
             WHERE wo.asset_id = a.asset_id AND wo.status = 'Overdue') AS oldest_overdue_due_date,
            (SELECT COUNT(*) FROM field_reports fr
             WHERE fr.asset_id = a.asset_id AND fr.severity IN ('High', 'Critical')
             AND fr.submitted_at > NOW() - INTERVAL '48 hours') AS recent_high_severity_reports
        FROM assets a
        WITH NO DATA;
        """
    )
    op.execute("CREATE UNIQUE INDEX ix_ors_asset ON operational_risk_snapshot (asset_id);")


def downgrade() -> None:
    op.execute("DROP MATERIALIZED VIEW IF EXISTS operational_risk_snapshot;")
    for table in ("audit_log", "operator_decisions", "predictions"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_update ON {table};")
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_no_delete ON {table};")
        op.execute(f"DROP FUNCTION IF EXISTS {table}_append_only();")
    op.drop_table("audit_log")
    op.drop_table("operator_decisions")
    op.drop_table("predictions")
    op.drop_table("model_versions")
    op.drop_table("asset_id_crosswalk")
    op.drop_table("asset_dependencies")
    op.drop_table("historical_events")
    op.drop_table("hurricane_tracks")
    op.drop_table("weather_alerts")
    op.drop_table("weather_forecasts")
    op.drop_table("weather_observations")
    op.drop_table("outages")
    op.drop_table("incidents")
    op.drop_table("field_reports")
    op.drop_table("crew_status")
    op.drop_table("crews")
    op.execute("DROP TABLE IF EXISTS sensor_readings CASCADE;")
    op.drop_table("inspection_history")
    op.drop_table("work_orders")
    op.drop_table("hazard_zones")
    op.drop_table("service_areas")
    op.drop_table("assets")
    op.drop_table("regions")
