"""Phase 3 tests — ID resolver + feature builder."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from sgw_platform.db.models import AssetIdCrosswalk
from sgw_platform.db.session import session_scope
from sgw_platform.features.builder import build_features
from sgw_platform.ingestion.id_resolver import (
    AssetIdResolver,
    SourceSystem,
    UnknownAssetId,
)


@pytest.mark.asyncio
async def test_resolver_round_trips_known_ids() -> None:
    async with session_scope() as session:
        resolver = AssetIdResolver()
        await resolver.load(session)
        # Grab one row from the crosswalk to test end-to-end
        row = (await session.execute(select(AssetIdCrosswalk).limit(1))).scalars().first()
    assert row is not None
    assert resolver.resolve(SourceSystem.GIS, row.gis_id) == row.canonical_asset_id
    assert resolver.resolve(SourceSystem.MAINTENANCE, row.maintenance_id) == row.canonical_asset_id
    assert resolver.resolve(SourceSystem.SCADA, row.scada_id) == row.canonical_asset_id
    assert resolver.resolve(SourceSystem.FIELD_OPS, row.field_ops_id) == row.canonical_asset_id


@pytest.mark.asyncio
async def test_resolver_raises_on_unknown_id() -> None:
    async with session_scope() as session:
        resolver = AssetIdResolver()
        await resolver.load(session)
    with pytest.raises(UnknownAssetId):
        resolver.resolve(SourceSystem.GIS, "GIS-DOES-NOT-EXIST-999")


@pytest.mark.asyncio
async def test_feature_builder_produces_row_per_asset() -> None:
    async with session_scope() as session:
        # asset count
        row_count_result = await session.execute(select(AssetIdCrosswalk))
        asset_count = len(row_count_result.scalars().all())

        df = await build_features(session)

    assert len(df) == asset_count, f"expected {asset_count} rows, got {len(df)}"

    expected_cols = {
        "asset_id",
        "asset_type",
        "utility_domain",
        "region",
        "criticality_rating",
        "condition_score",
        "min_dist_to_flood_zone_m",
        "open_work_orders",
        "overdue_work_orders",
        "recent_high_severity_reports",
        "recent_scada_warnings",
        "within_active_alert_area",
        "within_hurricane_cone",
    }
    missing = expected_cols - set(df.columns)
    assert not missing, f"missing feature columns: {missing}"


@pytest.mark.asyncio
async def test_hurricane_cone_flag_is_populated_for_some_assets() -> None:
    """Debby's cone covers a swath of the SE US — some SGW assets must fall inside."""
    async with session_scope() as session:
        df = await build_features(session)
    in_cone = int(df["within_hurricane_cone"].sum())
    assert in_cone > 0, "no assets flagged within any hurricane cone"


@pytest.mark.asyncio
async def test_hazard_distances_are_non_null_for_all_assets() -> None:
    async with session_scope() as session:
        df = await build_features(session)
    # We have 4 hazard types in placeholder set — every asset should have a
    # distance to each (may be 0 if inside)
    for col in [
        "min_dist_to_flood_zone_m",
        "min_dist_to_surge_zone_m",
        "min_dist_to_wildfire_zone_m",
        "min_dist_to_heat_zone_m",
    ]:
        null_count = df[col].isna().sum()
        assert null_count == 0, f"{col} has {null_count} nulls"
