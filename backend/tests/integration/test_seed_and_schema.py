"""Phase 1 integration tests — run against the live seeded database.

These assume `python -m scripts.seed_from_raw` has been run (dev fixture invariant).
For CI these should be scoped into a testcontainers-postgres session and re-seeded per run;
kept simple here for local dev-loop speed.
"""

from __future__ import annotations

import hashlib
import uuid

import pytest
from sqlalchemy import text

from sgw_platform.db.session import session_scope


@pytest.mark.asyncio
async def test_row_counts_reasonable() -> None:
    async with session_scope() as session:
        counts = {}
        for table in [
            "regions",
            "assets",
            "service_areas",
            "hazard_zones",
            "asset_id_crosswalk",
            "asset_dependencies",
            "work_orders",
            "inspection_history",
            "crews",
            "crew_status",
            "field_reports",
            "incidents",
            "outages",
            "sensor_readings",
        ]:
            result = await session.execute(text(f"SELECT COUNT(*) FROM {table}"))
            counts[table] = result.scalar_one()

    assert counts["regions"] == 3
    assert 150 <= counts["assets"] <= 300, counts
    assert counts["asset_id_crosswalk"] == counts["assets"], "crosswalk must cover every asset"
    assert counts["service_areas"] >= 10
    assert counts["hazard_zones"] >= 8
    assert counts["work_orders"] >= 150
    assert counts["inspection_history"] >= 300
    assert 10_000 <= counts["sensor_readings"] <= 60_000, counts
    assert counts["field_reports"] >= 30
    assert counts["incidents"] >= 20
    assert counts["asset_dependencies"] >= 50


@pytest.mark.asyncio
async def test_referential_integrity_holds() -> None:
    """Every asset_id referenced from child tables must exist in assets."""
    async with session_scope() as session:
        for table, col in [
            ("work_orders", "asset_id"),
            ("inspection_history", "asset_id"),
            ("sensor_readings", "asset_id"),
            ("field_reports", "asset_id"),
            ("asset_id_crosswalk", "canonical_asset_id"),
            ("asset_dependencies", "upstream_asset_id"),
            ("asset_dependencies", "downstream_asset_id"),
        ]:
            result = await session.execute(
                text(
                    f"SELECT COUNT(*) FROM {table} t "
                    f"LEFT JOIN assets a ON t.{col} = a.asset_id "
                    f"WHERE a.asset_id IS NULL"
                )
            )
            orphans = result.scalar_one()
            assert orphans == 0, f"{table}.{col} has {orphans} orphans"


@pytest.mark.asyncio
async def test_postgis_spatial_index_present() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT indexname FROM pg_indexes "
                "WHERE schemaname='public' AND tablename='assets' "
                "AND indexdef ILIKE '%gist%'"
            )
        )
        indexes = [row[0] for row in result]
        assert any("geom" in i.lower() for i in indexes), indexes


@pytest.mark.asyncio
async def test_postgis_spatial_join_works() -> None:
    """Query assets that fall within a placeholder hazard zone — smoke of the whole GIS story."""
    async with session_scope() as session:
        result = await session.execute(
            text(
                """
                SELECT COUNT(DISTINCT a.asset_id)
                FROM assets a, hazard_zones h
                WHERE ST_Intersects(a.geom, h.geom)
                """
            )
        )
        count = result.scalar_one()
        # With placeholder hazard zones sized 0.08-0.15 deg (~10-16 km),
        # we expect at least a handful of assets to intersect at least one zone.
        assert count > 0, "spatial join returned 0 — hazard polygons may be misaligned"


@pytest.mark.asyncio
async def test_sensor_readings_partitions_exist() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT relname FROM pg_class "
                "WHERE relname LIKE 'sensor_readings_y%' "
                "ORDER BY relname"
            )
        )
        partitions = [row[0] for row in result]
        assert len(partitions) >= 6, partitions
        assert any("y2026m07" in p for p in partitions), partitions


@pytest.mark.asyncio
async def test_quality_flag_distribution_realistic() -> None:
    """~85–95% Valid, remainder distributed across noise flags."""
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT quality_flag, COUNT(*)::float / SUM(COUNT(*)) OVER () AS pct "
                "FROM sensor_readings GROUP BY quality_flag"
            )
        )
        dist = {row[0]: row[1] for row in result}
    valid_pct = dist.get("Valid", 0.0)
    assert 0.80 <= valid_pct <= 0.95, dist
    # Non-Valid flags cover at least three of the noise categories
    noise_kinds = set(dist.keys()) - {"Valid"}
    assert len(noise_kinds) >= 3, dist


@pytest.mark.asyncio
async def test_audit_log_append_only_trigger_fires() -> None:
    """Attempted UPDATE on audit_log must raise."""
    unique_hash = hashlib.sha256(uuid.uuid4().bytes).hexdigest()
    async with session_scope() as session:
        # Insert a row
        await session.execute(
            text(
                "INSERT INTO audit_log "
                "(timestamp, \"user\", action_type, subject_id, current_hash, payload) "
                "VALUES (NOW(), 'test', 'test_action', 'test_subject', :h, '{}'::jsonb)"
            ),
            {"h": unique_hash},
        )

    # Attempt update in a fresh transaction — trigger raises
    with pytest.raises(Exception, match="append-only"):
        async with session_scope() as session:
            await session.execute(
                text('UPDATE audit_log SET "user" = \'attacker\' WHERE current_hash = :h'),
                {"h": unique_hash},
            )


@pytest.mark.asyncio
async def test_predictions_append_only_trigger_fires() -> None:
    with pytest.raises(Exception, match="append-only"):
        async with session_scope() as session:
            # DELETE on empty table still triggers before-delete
            await session.execute(
                text(
                    "INSERT INTO predictions "
                    "(timestamp, asset_id, model_family, model_version, score, features_hash, payload) "
                    "VALUES (NOW(), (SELECT asset_id FROM assets LIMIT 1), 'test', '0.0.0', 0.5, '0', '{}'::jsonb)"
                )
            )
        async with session_scope() as session:
            await session.execute(text("DELETE FROM predictions WHERE model_family = 'test'"))


@pytest.mark.asyncio
async def test_operational_risk_snapshot_matview_refresh() -> None:
    async with session_scope() as session:
        # Refresh should complete without error
        await session.execute(text("REFRESH MATERIALIZED VIEW operational_risk_snapshot;"))
        result = await session.execute(text("SELECT COUNT(*) FROM operational_risk_snapshot"))
        count = result.scalar_one()
    # Should equal the asset count
    async with session_scope() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM assets"))
        expected = result.scalar_one()
    assert count == expected


@pytest.mark.asyncio
async def test_crosswalk_ids_are_deliberately_distinct() -> None:
    """The crosswalk must actually cross-walk — source IDs should not equal the canonical."""
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*) FROM asset_id_crosswalk "
                "WHERE gis_id = canonical_asset_id "
                "  OR scada_id = canonical_asset_id "
                "  OR maintenance_id = canonical_asset_id"
            )
        )
        same_id = result.scalar_one()
    assert same_id == 0, "crosswalk IDs collapsed to canonical — fragmentation invariant broken"
