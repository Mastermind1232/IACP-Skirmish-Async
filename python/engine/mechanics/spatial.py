"""Spatial / BFS helpers — Python mirror of src/game/spatial.js.

Scope for this leaf port:
  - get_all_figure_coords(game): both-player figure coordinate set
  - is_within_spaces(map_spaces, a, b, max_dist): bool BFS check
  - count_spaces(map_spaces, a, b, blocked_edges=None, max_dist=50):
      shortest-path distance in graph-steps, respects closed-door edges

Higher-level LOS lives in los.py (already ported). Figure-range queries
(getFiguresWithinRange, etc.) are deferred until a caller needs them.
"""
from __future__ import annotations

import math
from typing import Any, Dict, Optional, Set


INFINITY = math.inf


def get_all_figure_coords(game: Any) -> Set[str]:
    """Collect all figure coords from both players, normalized to lowercase."""
    data = _data(game)
    coords: Set[str] = set()
    positions = data.get('figurePositions') or {}
    for pn in (1, 2):
        for fp in (positions.get(pn) or {}).values():
            if fp:
                coords.add(str(fp).lower())
    return coords


def is_within_spaces(map_spaces: Optional[Dict[str, Any]], coord_a: str,
                     coord_b: str, max_dist: int) -> bool:
    """BFS: can you walk from a to b in ≤max_dist adjacency steps?"""
    if not map_spaces or not map_spaces.get('adjacency') or not coord_a or not coord_b:
        return False
    a = coord_a.lower()
    b = coord_b.lower()
    if a == b:
        return True
    adj_map = map_spaces['adjacency']
    visited = {a}
    frontier = [a]
    for _ in range(max_dist):
        nxt = []
        for c in frontier:
            for adj in (adj_map.get(c) or []):
                s = str(adj).lower()
                if s == b:
                    return True
                if s not in visited:
                    visited.add(s)
                    nxt.append(s)
        frontier = nxt
        if not frontier:
            break
    return False


def count_spaces(map_spaces: Optional[Dict[str, Any]], coord_a: str,
                 coord_b: str, blocked_edges: Optional[Set[str]] = None,
                 max_dist: int = 50) -> float:
    """Graph-distance BFS. Returns INFINITY when unreachable, 0 for same cell.

    Mirrors src/game/spatial.js:countSpaces. blocked_edges is a set of
    'coordA|coordB' edge keys (canonicalized via sort) representing closed
    doors. max_dist caps BFS depth.
    """
    if not map_spaces or not map_spaces.get('adjacency') or not coord_a or not coord_b:
        return INFINITY
    a = coord_a.lower()
    b = coord_b.lower()
    if a == b:
        return 0
    adj_map = map_spaces['adjacency']
    visited = {a}
    frontier = [a]
    for d in range(1, max_dist + 1):
        nxt = []
        for c in frontier:
            for adj in (adj_map.get(c) or []):
                s = str(adj).lower()
                if blocked_edges is not None:
                    ek = '|'.join(sorted([c, s]))
                    if ek in blocked_edges:
                        continue
                if s == b:
                    return d
                if s not in visited:
                    visited.add(s)
                    nxt.append(s)
        frontier = nxt
        if not frontier:
            break
    return INFINITY


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'spatial expected GameState or dict, got {type(game).__name__}'
    )
