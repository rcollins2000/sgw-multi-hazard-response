"""Feature builder — produces the per-asset feature frame for AI models.

Uses PostGIS spatial joins to compute hazard proximity + weather features and
joins operational history + inspection records + field reports.

Output columns (per asset):
    asset_id, asset_type, utility_domain, region,
    criticality_rating, condition_score, service_population,
    flood_zone, ground_elevation_ft, has_backup_power,
    min_dist_to_flood_zone_m, min_dist_to_surge_zone_m,
    min_dist_to_wildfire_zone_m, min_dist_to_heat_zone_m,
    open_work_orders, overdue_work_orders,
    inspections_last_year, avg_recent_condition,
    recent_high_severity_reports, recent_scada_warnings,
    days_since_last_inspection,
    within_active_alert_area   (int 0/1),
    within_hurricane_cone      (int 0/1)
"""

from __future__ import annotations

import pandas as pd
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

FEATURE_SQL = """
WITH asset_hazard_distances AS (
    SELECT
        a.asset_id,
        MIN(CASE WHEN h.hazard_type = 'flood_zone' THEN ST_Distance(a.geom::geography, h.geom::geography) END) AS min_dist_to_flood_zone_m,
        MIN(CASE WHEN h.hazard_type = 'storm_surge' THEN ST_Distance(a.geom::geography, h.geom::geography) END) AS min_dist_to_surge_zone_m,
        MIN(CASE WHEN h.hazard_type = 'wildfire_risk' THEN ST_Distance(a.geom::geography, h.geom::geography) END) AS min_dist_to_wildfire_zone_m,
        MIN(CASE WHEN h.hazard_type = 'extreme_heat' THEN ST_Distance(a.geom::geography, h.geom::geography) END) AS min_dist_to_heat_zone_m
    FROM assets a
    LEFT JOIN hazard_zones h ON TRUE
    GROUP BY a.asset_id
),
work_agg AS (
    SELECT
        asset_id,
        COUNT(*) FILTER (WHERE status IN ('Overdue', 'In progress', 'Scheduled')) AS open_work_orders,
        COUNT(*) FILTER (WHERE status = 'Overdue') AS overdue_work_orders
    FROM work_orders GROUP BY asset_id
),
insp_agg AS (
    SELECT
        asset_id,
        COUNT(*) FILTER (WHERE inspected_at >= (CURRENT_DATE - INTERVAL '365 days')) AS inspections_last_year,
        AVG(condition_score) FILTER (WHERE inspected_at >= (CURRENT_DATE - INTERVAL '365 days')) AS avg_recent_condition,
        MAX(inspected_at) AS last_inspection_date
    FROM inspection_history GROUP BY asset_id
),
field_agg AS (
    SELECT
        asset_id,
        COUNT(*) FILTER (
            WHERE severity IN ('High', 'Critical')
              AND submitted_at > NOW() - INTERVAL '72 hours'
        ) AS recent_high_severity_reports
    FROM field_reports GROUP BY asset_id
),
scada_agg AS (
    SELECT
        asset_id,
        COUNT(*) FILTER (
            WHERE quality_flag IN ('Warning', 'Outlier', 'Sensor fault')
              AND timestamp > NOW() - INTERVAL '72 hours'
        ) AS recent_scada_warnings
    FROM sensor_readings GROUP BY asset_id
),
alert_hits AS (
    SELECT DISTINCT a.asset_id, 1 AS within_active_alert_area
    FROM assets a, hazard_zones h
    WHERE ST_Intersects(a.geom, h.geom)
),
cone_hits AS (
    SELECT DISTINCT a.asset_id, 1 AS within_hurricane_cone
    FROM assets a, hurricane_tracks ht
    WHERE ST_Intersects(a.geom, ht.cone)
)
SELECT
    a.asset_id,
    a.asset_type,
    a.utility_domain,
    a.region,
    a.criticality_rating,
    a.condition_score,
    a.service_population,
    a.flood_zone,
    a.ground_elevation_ft,
    CASE WHEN a.backup_power IS NOT NULL THEN 1 ELSE 0 END AS has_backup_power,
    ahd.min_dist_to_flood_zone_m,
    ahd.min_dist_to_surge_zone_m,
    ahd.min_dist_to_wildfire_zone_m,
    ahd.min_dist_to_heat_zone_m,
    COALESCE(wo.open_work_orders, 0)::int AS open_work_orders,
    COALESCE(wo.overdue_work_orders, 0)::int AS overdue_work_orders,
    COALESCE(ins.inspections_last_year, 0)::int AS inspections_last_year,
    ins.avg_recent_condition,
    (CURRENT_DATE - ins.last_inspection_date) AS days_since_last_inspection,
    COALESCE(fr.recent_high_severity_reports, 0)::int AS recent_high_severity_reports,
    COALESCE(sa.recent_scada_warnings, 0)::int AS recent_scada_warnings,
    COALESCE(ah.within_active_alert_area, 0) AS within_active_alert_area,
    COALESCE(ch.within_hurricane_cone, 0) AS within_hurricane_cone
FROM assets a
LEFT JOIN asset_hazard_distances ahd ON ahd.asset_id = a.asset_id
LEFT JOIN work_agg wo ON wo.asset_id = a.asset_id
LEFT JOIN insp_agg ins ON ins.asset_id = a.asset_id
LEFT JOIN field_agg fr ON fr.asset_id = a.asset_id
LEFT JOIN scada_agg sa ON sa.asset_id = a.asset_id
LEFT JOIN alert_hits ah ON ah.asset_id = a.asset_id
LEFT JOIN cone_hits ch ON ch.asset_id = a.asset_id
"""


async def build_features(session: AsyncSession) -> pd.DataFrame:
    """Return the current per-asset feature frame."""
    result = await session.execute(text(FEATURE_SQL))
    rows = result.mappings().all()
    df = pd.DataFrame(rows)
    if "days_since_last_inspection" in df.columns:
        df["days_since_last_inspection"] = df["days_since_last_inspection"].apply(
            lambda v: getattr(v, "days", None) if v is not None else None
        )
    return df


async def refresh_snapshot(session: AsyncSession) -> None:
    """Refresh the materialised view."""
    await session.execute(text("REFRESH MATERIALIZED VIEW operational_risk_snapshot;"))
