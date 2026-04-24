"""Line-of-sight (D2.4 + D2.5 + D2.6).

Port of `src/game/spatial.js:hasLineOfSight` and its three private helpers:

  - impassable_edge_to_wall_segment(c1, c2) -> wall segment or None
  - segments_strictly_intersect(...) -> bool, EPS=1e-6
  - get_cells_along_line(...) -> list of (col, row), JS Math.round rasterizer
  - get_threaded_corners(...) -> list of (cx, cy) grid corners the ray threads

IACP corner-to-corner rule (CRR p.22, p.28):
  - Inset each cell's corners by INSET=0.49 to get 4 "representative points."
  - For each attacker-inset-point, at least 2 target-inset-points must be
    visible (no wall between, no blocking cell on the rasterized path,
    no corner with ≥2 obstacles threaded by the ray).
  - Source and destination cells are self-excluded from the blocking check —
    this is the "shield-on-endpoint" Energy Shield carve-out (LOS-06).

Figure-blocking (D2.5): callers pass a `figure_blocking_coords` set; any cell
in that set (other than source/dest) on the rasterized path blocks LOS and
contributes to corner-obstacle counts, exactly like terrain blocking.

Energy Shield exception (D2.6): handler-side code merges shield coords into
`map_spaces['blocking']` BEFORE calling here, so shield blocking is just
terrain blocking for this function. Self-exclusion at source/dest gives the
OUT-of/INTO carveouts; the generic path-check gives the between-cells block.
"""
import math
from typing import Iterable, List, Optional, Set, Tuple

from .coords import parse_coord, col_row_to_coord


_EPS_WALL = 1e-10       # denominator-guard EPS for parallel-segment test
_EPS_T = 1e-6           # strict-endpoint EPS for segment intersection
_EPS_CORNER = 1e-9      # corner-threading parameter-range EPS
_CORNER_TOL = 1e-6      # floating-point tolerance for corner coincidence
INSET = 0.49            # fixed per CRR corner-inset rule


def _js_round(x: float) -> int:
    """JS `Math.round`: round half toward +infinity. Python's round() does
    banker's rounding, so we can't use it directly."""
    return math.floor(x + 0.5)


def impassable_edge_to_wall_segment(c1: str, c2: str):
    """Convert an adjacent-cell edge to a wall segment at the shared boundary.

    Returns {x1, y1, x2, y2} or None if the cells aren't orthogonally adjacent.
    JS uses an object; here we use a dict for parity.
    """
    ax, ay = parse_coord(str(c1).lower())
    bx, by = parse_coord(str(c2).lower())
    if ax < 0 or bx < 0:
        return None
    dc, dr = bx - ax, by - ay
    if abs(dc) + abs(dr) != 1:
        return None
    if dr == 0:
        # Vertical wall between two horizontally-adjacent cells.
        x = min(ax, bx) + 0.5
        return {'x1': x, 'y1': ay - 0.5, 'x2': x, 'y2': ay + 0.5}
    else:
        # Horizontal wall between two vertically-adjacent cells.
        y = min(ay, by) + 0.5
        return {'x1': ax - 0.5, 'y1': y, 'x2': ax + 0.5, 'y2': y}


def segments_strictly_intersect(x1, y1, x2, y2, x3, y3, x4, y4) -> bool:
    """Strict segment intersection with EPS=1e-6 endpoint exclusion.

    Returns True iff the two open segments (excluding endpoints) cross.
    """
    d1x, d1y = x2 - x1, y2 - y1
    d2x, d2y = x4 - x3, y4 - y3
    denom = d1x * d2y - d1y * d2x
    if abs(denom) < _EPS_WALL:
        return False
    t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / denom
    u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / denom
    return (_EPS_T < t < 1 - _EPS_T) and (_EPS_T < u < 1 - _EPS_T)


def get_cells_along_line(x1: float, y1: float, x2: float, y2: float
                          ) -> List[Tuple[int, int]]:
    """Rasterize a line to cell (col, row) pairs using JS Math.round sampling.

    Matches `src/game/spatial.js:getCellsAlongLine` exactly: step count is
    max(ceil(length * 4), 1), sampled uniformly, unique cells preserved in
    order of first appearance.
    """
    dx, dy = x2 - x1, y2 - y1
    length = math.sqrt(dx * dx + dy * dy)
    steps = max(math.ceil(length * 4), 1)
    seen: Set[Tuple[int, int]] = set()
    result: List[Tuple[int, int]] = []
    for i in range(steps + 1):
        t = i / steps
        col = _js_round(x1 + t * dx)
        row = _js_round(y1 + t * dy)
        key = (col, row)
        if key not in seen:
            seen.add(key)
            result.append(key)
    return result


def get_threaded_corners(x1: float, y1: float, x2: float, y2: float
                         ) -> List[Tuple[float, float]]:
    """Return every half-integer grid corner the open segment threads.

    Mirrors `spatial.js:getThreadedCorners`: only diagonal-slope rays can
    thread corners (axis-aligned never do). Excludes the segment endpoints.
    """
    dx, dy = x2 - x1, y2 - y1
    corners: List[Tuple[float, float]] = []
    x_min, x_max = min(x1, x2), max(x1, x2)
    y_min, y_max = min(y1, y2), max(y1, y2)
    k_min = math.ceil(x_min - 0.5 - _EPS_CORNER)
    k_max = math.floor(x_max - 0.5 + _EPS_CORNER)
    l_min = math.ceil(y_min - 0.5 - _EPS_CORNER)
    l_max = math.floor(y_max - 0.5 + _EPS_CORNER)
    for k in range(k_min, k_max + 1):
        for l in range(l_min, l_max + 1):
            cx, cy = k + 0.5, l + 0.5
            # Pick the stabler axis for the parameter computation.
            if abs(dx) >= abs(dy):
                if abs(dx) < _EPS_CORNER:
                    continue
                t = (cx - x1) / dx
            else:
                t = (cy - y1) / dy
            if t <= _EPS_CORNER or t >= 1 - _EPS_CORNER:
                continue
            px = x1 + t * dx
            py = y1 + t * dy
            if abs(px - cx) > _CORNER_TOL or abs(py - cy) > _CORNER_TOL:
                continue
            corners.append((cx, cy))
    return corners


def build_los_blocking_set(game: Any, attacker_key: str) -> set:
    """Collect the set of LOS-blocking cells: every other figure's
    footprint (both sides), excluding the attacker's own footprint,
    MASSIVE figures, and companion figures.

    Mirrors JS `available-actions.js:2233-2246`. Callers pass this set
    into `has_line_of_sight` as `figure_blocking_coords`.
    """
    from python.engine.data.dc_effects_loader import get_dc_effect
    from python.engine.mechanics.board_helpers import (
        get_effective_figure_size,
    )
    from python.engine.mechanics.coords import (
        get_footprint_cells, normalize_coord,
    )
    from python.engine.mechanics.dc_helpers import dc_name_from_figure_key

    data = game.data if hasattr(game, 'data') else game
    positions_map = data.get('figurePositions') or {}
    # Compute attacker's footprint so it doesn't self-block.
    att_footprint: set = set()
    for pn_key, poses in positions_map.items():
        if not isinstance(poses, dict):
            continue
        for fk, pos in poses.items():
            if fk == attacker_key and pos:
                size = get_effective_figure_size(
                    game, fk, dc_name_from_figure_key(fk),
                )
                for c in get_footprint_cells(pos, size):
                    att_footprint.add(normalize_coord(c))
    blocking: set = set()
    for pn_key, poses in positions_map.items():
        if not isinstance(poses, dict):
            continue
        for fk, pos in poses.items():
            if not pos or fk == attacker_key:
                continue
            dc_name = dc_name_from_figure_key(fk)
            eff = get_dc_effect(dc_name) or {}
            # Companions and MASSIVE figures don't block LOS.
            if eff.get('companion') is True:
                continue
            if any(str(k).upper() == 'MASSIVE'
                   for k in (eff.get('keywords') or [])):
                continue
            size = get_effective_figure_size(game, fk, dc_name)
            for c in get_footprint_cells(pos, size):
                nc = normalize_coord(c)
                if nc in att_footprint:
                    continue
                blocking.add(nc)
    return blocking


def map_spaces_with_open_doors(map_spaces: dict,
                                opened_doors: Iterable[str]) -> dict:
    """Return a shallow copy of `map_spaces` with `impassableEdges`
    filtered to exclude any open-door edges.

    `opened_doors` is a list of `"a|b"` or `"b|a"` edge-key strings
    (matches JS `game.openedDoors` shape).
    """
    if not map_spaces:
        return map_spaces
    impassable = map_spaces.get('impassableEdges') or []
    if not impassable or not opened_doors:
        return map_spaces
    opened = {str(k).lower() for k in opened_doors}
    if not opened:
        return map_spaces
    filtered = []
    for edge in impassable:
        if not isinstance(edge, (list, tuple)) or len(edge) < 2:
            filtered.append(edge)
            continue
        a = str(edge[0]).lower()
        b = str(edge[1]).lower()
        key_ab = f'{a}|{b}'
        key_ba = f'{b}|{a}'
        if key_ab in opened or key_ba in opened:
            continue
        filtered.append(edge)
    return {**map_spaces, 'impassableEdges': filtered}


def has_line_of_sight(coord1: str, coord2: str, map_spaces: dict,
                      figure_blocking_coords: Optional[Iterable[str]] = None
                      ) -> bool:
    """Corner-to-corner LOS per IACP CRR.

    Matches `src/game/spatial.js:hasLineOfSight` behavior byte-for-byte on
    all probe inputs (verified by los-slice2 + los-06 oracle ports).

    Args:
        coord1: attacker cell (lowercase string)
        coord2: target cell
        map_spaces: {blocking: [...], impassableEdges: [[a,b],...]}
        figure_blocking_coords: optional Set[str] of figure cells that block LOS
    """
    blocking_iter = (map_spaces or {}).get('blocking', []) or []
    blocking_set: Set[str] = {str(s).lower() for s in blocking_iter}
    impassable_edges = (map_spaces or {}).get('impassableEdges', []) or []
    fig_set: Optional[Set[str]] = None
    if figure_blocking_coords is not None:
        fig_set = {str(s).lower() for s in figure_blocking_coords}

    a_col, a_row = parse_coord(coord1)
    b_col, b_row = parse_coord(coord2)
    if a_col < 0 or a_row < 0 or b_col < 0 or b_row < 0:
        return False
    if a_col == b_col and a_row == b_row:
        return True

    walls: List[dict] = []
    for edge in impassable_edges:
        seg = impassable_edge_to_wall_segment(edge[0], edge[1])
        if seg is not None:
            walls.append(seg)

    def corners(col: int, row: int) -> List[Tuple[float, float]]:
        return [
            (col - INSET, row - INSET),
            (col + INSET, row - INSET),
            (col - INSET, row + INSET),
            (col + INSET, row + INSET),
        ]

    a_corners = corners(a_col, a_row)
    b_corners = corners(b_col, b_row)

    # From each attacker-corner representative point, at least 2 target
    # corners must be visible for LOS to be traced.
    for (ax, ay) in a_corners:
        visible_target_corners = 0
        for (bx, by) in b_corners:
            wall_blocked = False
            for w in walls:
                if segments_strictly_intersect(ax, ay, bx, by,
                                                w['x1'], w['y1'], w['x2'], w['y2']):
                    wall_blocked = True
                    break
            if wall_blocked:
                continue
            cells = get_cells_along_line(ax, ay, bx, by)
            space_blocked = False
            for (col, row) in cells:
                if col == a_col and row == a_row:
                    continue  # self-exclusion — source shield/terrain ok
                if col == b_col and row == b_row:
                    continue  # self-exclusion — target shield/terrain ok
                coord = col_row_to_coord(col, row)
                if coord in blocking_set:
                    space_blocked = True
                    break
                if fig_set is not None and coord in fig_set:
                    space_blocked = True
                    break
            if space_blocked:
                continue

            # CRR p.22 / p.28 corner-obstacle count. Only diagonal-slope rays
            # thread half-integer corners; axis-aligned rays skip this loop.
            corner_blocked = False
            for (cx, cy) in get_threaded_corners(ax, ay, bx, by):
                count = 0
                k = _js_round(cx - 0.5)
                l = _js_round(cy - 0.5)
                for (cc, cr) in ((k, l), (k + 1, l), (k, l + 1), (k + 1, l + 1)):
                    if cc == a_col and cr == a_row:
                        continue
                    if cc == b_col and cr == b_row:
                        continue
                    coord = col_row_to_coord(cc, cr)
                    if coord in blocking_set:
                        count += 1
                    elif fig_set is not None and coord in fig_set:
                        count += 1
                for w in walls:
                    if ((abs(w['x1'] - cx) < _CORNER_TOL and abs(w['y1'] - cy) < _CORNER_TOL)
                        or (abs(w['x2'] - cx) < _CORNER_TOL and abs(w['y2'] - cy) < _CORNER_TOL)):
                        count += 1
                if count >= 2:
                    corner_blocked = True
                    break

            if not corner_blocked:
                visible_target_corners += 1
            if visible_target_corners >= 2:
                return True
    return False
