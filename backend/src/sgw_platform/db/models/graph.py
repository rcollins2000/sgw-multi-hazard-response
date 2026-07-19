"""Graph — asset dependencies + ID crosswalk."""

from __future__ import annotations

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from sgw_platform.db.base import Base


class AssetDependency(Base):
    __tablename__ = "asset_dependencies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    upstream_asset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("assets.asset_id"), nullable=False, index=True
    )
    downstream_asset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("assets.asset_id"), nullable=False, index=True
    )
    dependency_type: Mapped[str] = mapped_column(String(64), nullable=False)
    consequence_if_lost: Mapped[str | None] = mapped_column(String(512), nullable=True)


class AssetIdCrosswalk(Base):
    __tablename__ = "asset_id_crosswalk"

    canonical_asset_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("assets.asset_id"), primary_key=True
    )
    gis_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    maintenance_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    scada_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    field_ops_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
