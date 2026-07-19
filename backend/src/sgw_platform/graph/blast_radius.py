"""Louvain community detection → blast-radius clusters.

Communities of assets that would fail together — same technique the user applied
to entitlements-portal graphs. Operator UI filters by cluster ID.
"""

from __future__ import annotations

from dataclasses import dataclass

import community as community_louvain  # python-louvain
import networkx as nx


@dataclass
class BlastRadiusResult:
    cluster_assignment: dict[str, int]  # asset_id → cluster_id
    n_clusters: int
    modularity: float


def compute_blast_radius(digraph: nx.DiGraph, seed: int = 42) -> BlastRadiusResult:
    """Louvain runs on undirected — convert first."""
    if digraph.number_of_nodes() == 0:
        return BlastRadiusResult(cluster_assignment={}, n_clusters=0, modularity=0.0)

    undirected = digraph.to_undirected()
    partition = community_louvain.best_partition(undirected, random_state=seed)
    modularity = community_louvain.modularity(partition, undirected)
    n_clusters = len(set(partition.values()))
    return BlastRadiusResult(cluster_assignment=partition, n_clusters=n_clusters, modularity=modularity)
