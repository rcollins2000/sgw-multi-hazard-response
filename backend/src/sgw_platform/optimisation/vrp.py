"""Crew pre-positioning as a Vehicle Routing Problem (OR-Tools).

Assigns each available crew a sequence of at-risk assets to pre-position at,
minimising total weighted travel time (Haversine). Uses Guided Local Search
metaheuristic — same technique as the user's prior TSP work.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from ortools.constraint_solver import pywrapcp, routing_enums_pb2


@dataclass
class VrpInputs:
    """Locations[0] is the depot; each crew starts + ends here."""

    crew_ids: list[str]
    depot: tuple[float, float]
    asset_locations: list[tuple[float, float]]  # (lat, lng)
    asset_ids: list[str]
    asset_priorities: list[float]  # higher = more urgent (used to weight distance)
    max_stops_per_crew: int = 5


@dataclass
class VrpOutput:
    routes: dict[str, list[str]]  # crew_id -> ordered list of asset_ids
    total_weighted_distance_m: float
    baseline_greedy_distance_m: float
    improvement_pct: float


def _haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lng1 = math.radians(a[0]), math.radians(a[1])
    lat2, lng2 = math.radians(b[0]), math.radians(b[1])
    dlat = lat2 - lat1
    dlng = lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6_371_000.0 * 2 * math.asin(math.sqrt(h))


def _distance_matrix(points: list[tuple[float, float]], weights: list[float]) -> list[list[int]]:
    n = len(points)
    matrix = [[0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            base = _haversine_m(points[i], points[j])
            # Multiply outgoing edge distance by inverse priority of destination — heavier assets pull first
            w = weights[j] if j > 0 else 1.0
            matrix[i][j] = int(base / max(w, 0.1))
    return matrix


def _greedy_baseline(points: list[tuple[float, float]], num_crews: int) -> float:
    """Nearest-neighbour split — a simple baseline to compare VRP against."""
    if len(points) <= 1:
        return 0.0
    remaining = list(range(1, len(points)))
    depot = points[0]
    routes: list[list[int]] = [[] for _ in range(num_crews)]
    curr_pos = [depot for _ in range(num_crews)]
    k = 0
    while remaining:
        # crew k picks nearest remaining
        nearest = min(remaining, key=lambda idx: _haversine_m(curr_pos[k], points[idx]))
        routes[k].append(nearest)
        curr_pos[k] = points[nearest]
        remaining.remove(nearest)
        k = (k + 1) % num_crews

    total = 0.0
    for r_idx, route in enumerate(routes):
        pos = depot
        for idx in route:
            total += _haversine_m(pos, points[idx])
            pos = points[idx]
        total += _haversine_m(pos, depot)
    return total


def solve_vrp(inputs: VrpInputs, time_limit_s: int = 5) -> VrpOutput:
    n_crews = len(inputs.crew_ids)
    if not inputs.asset_ids:
        return VrpOutput(
            routes={c: [] for c in inputs.crew_ids},
            total_weighted_distance_m=0.0,
            baseline_greedy_distance_m=0.0,
            improvement_pct=0.0,
        )
    if n_crews == 0:
        raise ValueError("at least one crew required")

    points = [inputs.depot, *inputs.asset_locations]
    weights = [1.0, *inputs.asset_priorities]
    matrix = _distance_matrix(points, weights)

    manager = pywrapcp.RoutingIndexManager(len(points), n_crews, 0)  # single depot at 0
    routing = pywrapcp.RoutingModel(manager)

    def dist_cb(from_i: int, to_i: int) -> int:
        return matrix[manager.IndexToNode(from_i)][manager.IndexToNode(to_i)]

    transit_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    routing.AddDimension(transit_idx, 0, 10_000_000, True, "Distance")

    # Cap stops per crew (soft — enforced via routing dimension)
    def one_cb(_from_i: int, _to_i: int) -> int:
        return 1

    count_idx = routing.RegisterTransitCallback(one_cb)
    routing.AddDimension(count_idx, 0, inputs.max_stops_per_crew + 1, True, "StopCount")

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = time_limit_s

    solution = routing.SolveWithParameters(params)
    if not solution:
        raise RuntimeError("no VRP solution found — try increasing time_limit or max_stops")

    routes: dict[str, list[str]] = {}
    total = 0.0
    for v in range(n_crews):
        crew_id = inputs.crew_ids[v]
        route: list[str] = []
        idx = routing.Start(v)
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node != 0:
                route.append(inputs.asset_ids[node - 1])
            nxt = solution.Value(routing.NextVar(idx))
            if not routing.IsEnd(nxt):
                total += matrix[manager.IndexToNode(idx)][manager.IndexToNode(nxt)]
            idx = nxt
        routes[crew_id] = route

    baseline = _greedy_baseline(points, n_crews)
    improvement = 100.0 * (baseline - total) / baseline if baseline > 0 else 0.0
    return VrpOutput(
        routes=routes,
        total_weighted_distance_m=total,
        baseline_greedy_distance_m=baseline,
        improvement_pct=improvement,
    )
