"""Phase 2 integration tests — real NOAA fixtures loaded into Postgres."""

from __future__ import annotations

import pytest
from sqlalchemy import text

from sgw_platform.db.session import session_scope


@pytest.mark.asyncio
async def test_coops_observations_present() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT COUNT(*), MIN(water_level_ft), MAX(water_level_ft) "
                "FROM weather_observations "
                "WHERE source LIKE 'NOS_COOPS:%'"
            )
        )
        count, min_wl, max_wl = result.first()  # type: ignore[misc]
    assert count >= 2500, f"expected >=2500 CO-OPS observations, got {count}"
    # Charleston Harbor typical tidal range ~ -1 to 8 ft MLLW; storm surge extends up
    assert min_wl is not None and max_wl is not None
    assert -3.0 <= min_wl <= 3.0, f"min water level unrealistic: {min_wl}"
    assert 5.0 <= max_wl <= 15.0, f"max water level unrealistic: {max_wl}"


@pytest.mark.asyncio
async def test_debby_and_idalia_windows_both_present() -> None:
    async with session_scope() as session:
        for label, expected_min in (("debby_2024", 1500), ("idalia_2023", 1000)):
            result = await session.execute(
                text("SELECT COUNT(*) FROM weather_observations WHERE source = :s"),
                {"s": f"NOS_COOPS:{label}"},
            )
            n = result.scalar_one()
            assert n >= expected_min, f"{label} count too low: {n}"


@pytest.mark.asyncio
async def test_nws_alerts_have_normalised_hazard_types() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT hazard_type, COUNT(*) FROM weather_alerts "
                "GROUP BY hazard_type ORDER BY hazard_type"
            )
        )
        dist = {row[0]: row[1] for row in result}
    assert dist, "no NWS alerts loaded"
    allowed = {"hurricane", "flood", "heatwave", "wildfire", "other"}
    assert set(dist.keys()) <= allowed, f"unexpected hazard_types: {set(dist.keys()) - allowed}"


@pytest.mark.asyncio
async def test_hurricane_tracks_present_and_valid_geometry() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT storm_name, ST_IsValid(cone) AS cone_ok, "
                "ST_IsValid(track_line) AS track_ok, ST_NumPoints(track_line) AS pts "
                "FROM hurricane_tracks ORDER BY storm_name"
            )
        )
        rows = list(result)
    names = [r[0] for r in rows]
    assert "Debby" in names and "Idalia" in names, names
    for _, cone_ok, track_ok, pts in rows:
        assert cone_ok, "cone geometry invalid"
        assert track_ok, "track geometry invalid"
        assert pts >= 5, "track has too few points"


@pytest.mark.asyncio
async def test_hurricane_cone_intersects_assets_in_footprint() -> None:
    """Debby's forecast cone should overlap assets in SC/GA (the footprint)."""
    async with session_scope() as session:
        result = await session.execute(
            text(
                """
                SELECT COUNT(DISTINCT a.asset_id)
                FROM assets a, hurricane_tracks h
                WHERE h.storm_name = 'Debby'
                  AND ST_Intersects(a.geom, h.cone)
                """
            )
        )
        count = result.scalar_one()
    assert count > 0, "Debby cone should intersect at least some SGW assets"


@pytest.mark.asyncio
async def test_coops_observation_time_range_matches_debby_window() -> None:
    async with session_scope() as session:
        result = await session.execute(
            text(
                "SELECT MIN(observation_time), MAX(observation_time) "
                "FROM weather_observations WHERE source = 'NOS_COOPS:debby_2024'"
            )
        )
        min_t, max_t = result.first()  # type: ignore[misc]
    assert min_t.year == 2024 and min_t.month == 8
    assert max_t.year == 2024 and max_t.month == 8
    assert 3 <= min_t.day <= 9
    assert 3 <= max_t.day <= 9
