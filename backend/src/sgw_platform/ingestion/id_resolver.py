"""Asset ID resolver — canonicalises source-system IDs to `canonical_asset_id`.

Reads `asset_id_crosswalk` at first call, caches in-process. Explicitly raises on
unknown IDs rather than silently returning None — an unresolved ID is a data-quality
signal that should surface to the operator.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.db.models import AssetIdCrosswalk


class SourceSystem(str, Enum):
    GIS = "gis"
    MAINTENANCE = "maintenance"
    SCADA = "scada"
    FIELD_OPS = "field_ops"


class UnknownAssetId(RuntimeError):
    """Raised when an ID cannot be resolved to a canonical asset_id."""


@dataclass
class ResolverCache:
    by_gis: dict[str, str]
    by_maintenance: dict[str, str]
    by_scada: dict[str, str]
    by_field_ops: dict[str, str]

    def lookup(self, source: SourceSystem, source_id: str) -> str:
        table = {
            SourceSystem.GIS: self.by_gis,
            SourceSystem.MAINTENANCE: self.by_maintenance,
            SourceSystem.SCADA: self.by_scada,
            SourceSystem.FIELD_OPS: self.by_field_ops,
        }[source]
        canonical = table.get(source_id)
        if canonical is None:
            raise UnknownAssetId(f"{source.value} id {source_id!r} not in crosswalk")
        return canonical


class AssetIdResolver:
    """Loads the crosswalk once, then resolves in O(1)."""

    def __init__(self) -> None:
        self._cache: ResolverCache | None = None

    async def load(self, session: AsyncSession) -> None:
        result = await session.execute(select(AssetIdCrosswalk))
        rows = result.scalars().all()
        self._cache = ResolverCache(
            by_gis={r.gis_id: r.canonical_asset_id for r in rows if r.gis_id},
            by_maintenance={r.maintenance_id: r.canonical_asset_id for r in rows if r.maintenance_id},
            by_scada={r.scada_id: r.canonical_asset_id for r in rows if r.scada_id},
            by_field_ops={r.field_ops_id: r.canonical_asset_id for r in rows if r.field_ops_id},
        )

    def resolve(self, source: SourceSystem, source_id: str) -> str:
        if self._cache is None:
            raise RuntimeError("AssetIdResolver.load() must be called first")
        return self._cache.lookup(source, source_id)
