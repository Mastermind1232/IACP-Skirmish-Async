"""Adjacency rules (D2.3).

Three distinct concepts are exposed so callers don't conflate them:

  1. **Manhattan adjacency** — `is_manhattan_adjacent(a, b)` — grid-distance 1
     (4-connected). This is what LOS/combat/movement-cost use as "adjacent."
     Matches `src/game/spatial.js:isAdjacentCoords`.

  2. **Chebyshev adjacency** — `is_chebyshev_adjacent(a, b)` — 8-connected
     (includes diagonals). Used for targeting radii that count diagonals as
     distance 1, and for footprint-overlap pre-checks.

  3. **Map neighbors** — `get_map_neighbors(map_spaces, coord)` — the
     pre-computed 4-connected adjacency graph from `data/map-spaces.json`,
     which already excludes cells separated by walls. This is what the JS
     engine consults via `mapSpaces.adjacency[c]`.

  4. **Door adjacency** — `is_door_adjacent(figure_cells, door_cells)` —
     edge-sharing footprint-to-door rule per project_door_adjacency_rule.md.
     Diagonally-adjacent cells do NOT qualify; only cells that share a full
     edge with at least one door cell can interact with the door.

  5. **Graph-distance** — `count_spaces(map_spaces, a, b, blocked_edges, max_dist)`
     — shortest-path BFS through the adjacency graph, respecting a set of
     blocked edges (closed doors, etc.). Mirrors `src/game/spatial.js:countSpaces`.
     Returns `math.inf` when no path exists within `max_dist`.
"""
import math
from typing import Iterable, List, Optional, Set

from .coords import edge_key, parse_coord


def is_manhattan_adjacent(coord_a: str, coord_b: str) -> bool:
    """True iff the two coords differ by exactly 1 step in Manhattan metric."""
    ax, ay = parse_coord(coord_a)
    bx, by = parse_coord(coord_b)
    if ax < 0 or ay < 0 or bx < 0 or by < 0:
        return False
    return abs(ax - bx) + abs(ay - by) == 1


def is_chebyshev_adjacent(coord_a: str, coord_b: str) -> bool:
    """True iff the two coords differ by at most 1 in each axis (8-connected).
    Excludes the same-cell case."""
    ax, ay = parse_coord(coord_a)
    bx, by = parse_coord(coord_b)
    if ax < 0 or ay < 0 or bx < 0 or by < 0:
        return False
    dx, dy = abs(ax - bx), abs(ay - by)
    if dx == 0 and dy == 0:
        return False
    return dx <= 1 and dy <= 1


def get_map_neighbors(map_spaces: dict, coord: str) -> List[str]:
    """Look up pre-computed neighbors from the map adjacency graph.

    The JS engine treats `mapSpaces.adjacency` as source of truth — walls,
    impassable edges, and off-map cells are already excluded at data-gen
    time. Returns a fresh list so callers can mutate without side effects.
    """
    adj = (map_spaces or {}).get('adjacency', {}) or {}
    return list(adj.get(str(coord).lower(), []))


def is_door_adjacent(figure_cells: Iterable[str], door_cells: Iterable[str]) -> bool:
    """Per project_door_adjacency_rule: a figure can interact with a door only
    from a cell that shares an edge (Manhattan distance 1) with a door cell.
    Being on a door cell itself also qualifies (distance 0)."""
    door_list = [str(c).lower() for c in (door_cells or [])]
    if not door_list:
        return False
    for f in (figure_cells or []):
        f_lower = str(f).lower()
        for d in door_list:
            if f_lower == d:
                return True
            if is_manhattan_adjacent(f_lower, d):
                return True
    return False


def count_spaces(map_spaces: dict,
                 coord_a: str,
                 coord_b: str,
                 blocked_edges: Optional[Set[str]] = None,
                 max_dist: int = 50) -> float:
    """BFS shortest-path distance through map adjacency, respecting blocked edges.

    Port of `src/game/spatial.js:266-289` `countSpaces`. Returns math.inf when
    no path exists within max_dist. Inputs are lowercased (JS normalization).
    Same-cell returns 0. Empty/missing inputs return math.inf.

    `blocked_edges` uses the `edge_key(a, b)` sorted-pipe encoding so callers
    can build the set once from closed-door + sealed-edge sources.
    """
    if not map_spaces or not map_spaces.get('adjacency') or not coord_a or not coord_b:
        return math.inf
    adjacency = map_spaces['adjacency']
    a = str(coord_a).lower()
    b = str(coord_b).lower()
    if a == b:
        return 0
    visited: Set[str] = {a}
    frontier: List[str] = [a]
    for d in range(1, max_dist + 1):
        nxt: List[str] = []
        for c in frontier:
            for adj in adjacency.get(c, []) or []:
                s = str(adj).lower()
                if blocked_edges is not None and edge_key(c, s) in blocked_edges:
                    continue
                if s == b:
                    return d
                if s not in visited:
                    visited.add(s)
                    nxt.append(s)
        frontier = nxt
        if not frontier:
            break
    return math.inf
