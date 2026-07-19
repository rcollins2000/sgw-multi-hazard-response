"""Dependency-graph reasoning via networkx.

Loads `asset_dependencies` into a DiGraph once, then answers cascading-impact
queries via BFS from any flagged asset. Louvain clustering (blast-radius) lives
in `blast_radius.py`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import networkx as nx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sgw_platform.db.models import AssetDependency


@dataclass
class CascadeResult:
    root: str
    downstream: list[str]
    depth_map: dict[str, int]
    edges: list[tuple[str, str, str]] = field(default_factory=list)  # (u, v, consequence)


class DependencyGraph:
    """Directed graph: upstream → downstream."""

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()

    async def load(self, session: AsyncSession) -> None:
        result = await session.execute(select(AssetDependency))
        edges = result.scalars().all()
        g = nx.DiGraph()
        for e in edges:
            g.add_edge(
                e.upstream_asset_id,
                e.downstream_asset_id,
                dependency_type=e.dependency_type,
                consequence_if_lost=e.consequence_if_lost or "",
            )
        self.graph = g

    def cascade_from(self, asset_id: str, max_depth: int = 4) -> CascadeResult:
        if asset_id not in self.graph:
            return CascadeResult(root=asset_id, downstream=[], depth_map={})

        downstream: list[str] = []
        depth_map: dict[str, int] = {}
        edges: list[tuple[str, str, str]] = []

        for source, target in nx.bfs_edges(self.graph, asset_id, depth_limit=max_depth):
            downstream.append(target)
            depth_map[target] = depth_map.get(source, 0) + 1
            edge = self.graph[source][target]
            edges.append((source, target, edge.get("consequence_if_lost", "")))

        return CascadeResult(root=asset_id, downstream=downstream, depth_map=depth_map, edges=edges)

    def upstream_dependencies(self, asset_id: str) -> list[str]:
        if asset_id not in self.graph:
            return []
        return list(self.graph.predecessors(asset_id))
