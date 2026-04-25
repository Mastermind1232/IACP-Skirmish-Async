"""Movement cache + pathfinding (D2.7 / D2.8 / D2.9 / D2.10 / D2.11).

Port of `src/game/movement.js`:
  - computeMovementCache → compute_movement_cache
  - getMovementPath      → get_movement_path
  - getSpacesAtCost      → get_spaces_at_cost
  - getMovementTarget    → get_movement_target
  - getReachableSpaces   → get_reachable_spaces
  - getPathCost          → get_path_cost
  - MovementHeap, canMoveDiagonally, getNeighborStates, evaluateMovementStep

The Python heap mirrors the JS min-heap exactly: key = (cost, seq) so ties
break FIFO — output order is bit-identical to the JS `Array.sort((a,b)=>a.cost-b.cost)`
+ shift() approach relied on in existing parity tests.
"""
import heapq
import math
from typing import Any, Dict, List, Optional

from python.engine.mechanics.coords import (
    col_row_to_coord,
    edge_key,
    normalize_coord,
    parse_coord,
    rotate_size_string,
    shift_coord,
)
from python.engine.mechanics.movement_board import (
    MovementProfile,
    build_temp_board_state,
    get_normalized_footprint,
    movement_state_key,
    profile_from_size,
)


# ── MovementHeap ────────────────────────────────────────────────────────────

class MovementHeap:
    """Min-heap keyed on cost with FIFO tie-break on seq. Output order matches
    JS MovementHeap (see src/game/movement.js:596-635)."""

    __slots__ = ('_arr', '_seq')

    def __init__(self) -> None:
        self._arr: List = []
        self._seq = 0

    @property
    def size(self) -> int:
        return len(self._arr)

    def push(self, item: Dict[str, Any]) -> None:
        seq = self._seq
        self._seq += 1
        # heapq key: (cost, seq, item) — Python's default tuple compare handles tie-break.
        heapq.heappush(self._arr, (item['cost'], seq, item))

    def pop(self) -> Optional[Dict[str, Any]]:
        if not self._arr:
            return None
        _cost, _seq, item = heapq.heappop(self._arr)
        return item


# ── Diagonal + neighbor rules ───────────────────────────────────────────────

def can_move_diagonally(start: str, dx: int, dy: int, board: Dict[str, Any]) -> bool:
    """IA corner-cut rule. Port of JS canMoveDiagonally."""
    if not dx or not dy:
        return True
    start_lower = normalize_coord(start)
    col, row = parse_coord(start_lower)
    a_norm = normalize_coord(col_row_to_coord(col + dx, row))   # lateral corner (same row)
    b_norm = normalize_coord(col_row_to_coord(col, row + dy))   # vertical corner (same col)
    dest_norm = normalize_coord(col_row_to_coord(col + dx, row + dy))
    a_exists = a_norm in board['spacesSet']
    b_exists = b_norm in board['spacesSet']
    if not a_exists and not b_exists:
        return False
    adj_list = (board.get('adjacency') or {}).get(start_lower) or []
    adj_set = set(adj_list)
    mb = board.get('movementBlockingSet') or set()
    a_first_open = a_exists and a_norm in adj_set and edge_key(start_lower, a_norm) not in mb
    b_first_open = b_exists and b_norm in adj_set and edge_key(start_lower, b_norm) not in mb
    a_adj = (board.get('adjacency') or {}).get(a_norm)
    b_adj = (board.get('adjacency') or {}).get(b_norm)
    a_second_open = (
        a_first_open
        and edge_key(a_norm, dest_norm) not in mb
        and (a_adj is None or dest_norm in a_adj)
    )
    b_second_open = (
        b_first_open
        and edge_key(b_norm, dest_norm) not in mb
        and (b_adj is None or dest_norm in b_adj)
    )
    return a_second_open or b_second_open


def get_neighbor_states(state: Dict[str, Any], board: Dict[str, Any], profile: MovementProfile) -> List[Dict[str, Any]]:
    """Port of JS getNeighborStates. Produces move + rotate neighbor candidates."""
    neighbors: List[Dict[str, Any]] = []
    move_vectors = [
        (1, 0), (-1, 0), (0, 1), (0, -1),
    ]
    if profile.allow_diagonal:
        move_vectors.extend([(1, 1), (1, -1), (-1, 1), (-1, -1)])

    adj_for_cell = (board.get('adjacency') or {}).get(state['topLeft'])
    adj_set = set(adj_for_cell) if adj_for_cell is not None else None

    for dx, dy in move_vectors:
        is_diagonal = bool(dx and dy)
        if is_diagonal and profile.is_large:
            continue
        if is_diagonal and not can_move_diagonally(state['topLeft'], dx, dy, board):
            continue
        next_top_left = shift_coord(state['topLeft'], dx, dy)
        if not next_top_left or next_top_left not in board['spacesSet']:
            continue
        # For orthogonal moves, adjacency is authoritative for wall encoding.
        # Diagonal moves rely on canMoveDiagonally above.
        if not is_diagonal and adj_set is not None and next_top_left not in adj_set:
            continue
        neighbors.append({
            'type': 'move',
            'topLeft': next_top_left,
            'size': state['size'],
            'dx': dx,
            'dy': dy,
        })

    if profile.can_rotate:
        rotated = rotate_size_string(state['size'])
        neighbors.append({
            'type': 'rotate',
            'topLeft': state['topLeft'],
            'size': rotated,
            'dx': 0,
            'dy': 0,
        })
    return neighbors


# ── Step evaluation (terrain costs, footprint, blocking, hostile) ───────────

def evaluate_movement_step(current: Dict[str, Any], neighbor: Dict[str, Any], board: Dict[str, Any], profile: MovementProfile) -> Optional[Dict[str, Any]]:
    """Port of JS evaluateMovementStep.

    Returns None if the step is illegal; otherwise {cost, occupied, canEnd, footprint}.
    """
    next_footprint = get_normalized_footprint(neighbor['topLeft'], neighbor['size'])
    if not next_footprint:
        return None
    for cell in next_footprint:
        if cell not in board['spacesSet']:
            return None
    if not profile.ignore_blocking and not profile.treat_blocking_as_difficult:
        for cell in next_footprint:
            if cell in board['blockingSet']:
                return None
    prev_footprint = current['footprint']
    prev_set = set(prev_footprint)
    # Large figures must keep at least half their footprint in previously-occupied cells each step.
    if profile.is_large:
        overlap_count = sum(1 for c in next_footprint if c in prev_set)
        if overlap_count < math.ceil(len(next_footprint) / 2):
            return None
    if neighbor['type'] == 'rotate':
        overlapping = any(c in board['occupiedSet'] for c in next_footprint)
        if overlapping and not profile.can_end_on_occupied:
            return None
        return {
            'cost': 1,
            'occupied': overlapping,
            'canEnd': not overlapping or profile.can_end_on_occupied,
            'footprint': next_footprint,
        }
    entering = [c for c in next_footprint if c not in prev_set]
    if not entering:
        return None
    dx = neighbor['dx']
    dy = neighbor['dy']
    mb = board.get('movementBlockingSet') or set()
    if mb:
        back_dx = -1 if dx > 0 else (1 if dx < 0 else 0)
        back_dy = -1 if dy > 0 else (1 if dy < 0 else 0)
        for cell in entering:
            col, row = parse_coord(cell)
            prev_coord = col_row_to_coord(col + back_dx, row + back_dy)
            if normalize_coord(prev_coord) not in prev_set:
                continue
            if edge_key(cell, prev_coord) in mb:
                return None
    entering_blocking_cells = [c for c in entering if c in board['blockingSet']] if not profile.ignore_blocking else []
    # Mortar Trooper Haul: blocking/impassable become difficult instead of impassable.
    if entering_blocking_cells and not profile.treat_blocking_as_difficult:
        return None
    terrain = board.get('terrain') or {}
    entering_difficult = (
        not profile.ignore_difficult
        and (
            any((terrain.get(c) or 'normal') == 'difficult' for c in entering)
            or (profile.treat_blocking_as_difficult and bool(entering_blocking_cells))
        )
    )
    entering_occupied = any(c in board['occupiedSet'] for c in entering)
    host = board.get('hostileOccupiedSet')
    if host is not None:
        entering_hostile = any(c in host for c in entering)
    else:
        entering_hostile = entering_occupied
    base_cost = 1
    extra_cost = 0
    if entering_difficult:
        extra_cost += 1
    if entering_hostile and not profile.ignore_figure_cost:
        extra_cost += 1
    return {
        'cost': base_cost + extra_cost,
        'occupied': entering_occupied,
        'canEnd': not entering_occupied or profile.can_end_on_occupied,
        'footprint': next_footprint,
    }


# ── Core cache + API ────────────────────────────────────────────────────────

def compute_movement_cache(start_coord: str, mp_limit: int, board: Dict[str, Any], profile: MovementProfile) -> Dict[str, Any]:
    """Dijkstra-style cache port of JS computeMovementCache.

    Returns: {'nodes': {...}, 'cells': {...}, 'parent': {...}, 'maxMp': mp_limit}
    'cells' only records topLeft cells (see JS comment — recording non-topLeft
    footprint cells would permanently poison future-cheaper placements).
    """
    start_top_left = normalize_coord(start_coord)
    if not board or start_top_left not in (board.get('spacesSet') or set()):
        return {'nodes': {}, 'cells': {}, 'parent': {}, 'maxMp': mp_limit}
    start_key = movement_state_key(start_top_left, profile.size)
    queue = MovementHeap()
    queue.push({
        'key': start_key,
        'topLeft': start_top_left,
        'size': profile.size,
        'cost': 0,
        'footprint': get_normalized_footprint(start_top_left, profile.size),
    })
    best_cost: Dict[str, int] = {start_key: 0}
    nodes: Dict[str, Dict[str, Any]] = {}
    cells: Dict[str, Dict[str, Any]] = {}
    parent: Dict[str, str] = {}
    massive_set = board.get('massiveOccupiedSet')
    while queue.size > 0:
        current = queue.pop()
        if current['cost'] > mp_limit:
            continue
        # G64: massive figures cannot enter spaces occupied by other massive figures.
        hits_massive = (
            profile.is_massive and massive_set is not None
            and any(cell in massive_set for cell in current['footprint'])
        )
        if hits_massive:
            continue
        is_occupied = any(cell in board['occupiedSet'] for cell in current['footprint'])
        can_end = not is_occupied or profile.can_end_on_occupied
        node_copy = dict(current)
        node_copy['isOccupied'] = is_occupied
        node_copy['canEnd'] = can_end
        nodes[current['key']] = node_copy
        # Only record the topLeft cell (see JS comment in computeMovementCache
        # about permanent poisoning if non-topLeft footprint cells were added).
        if can_end and current['cost'] > 0:
            prev = cells.get(current['topLeft'])
            if prev is None or current['cost'] < prev['cost']:
                cells[current['topLeft']] = {
                    'cost': current['cost'],
                    'topLeft': current['topLeft'],
                    'size': current['size'],
                }
        for neighbor in get_neighbor_states(current, board, profile):
            step = evaluate_movement_step(current, neighbor, board, profile)
            if step is None:
                continue
            new_cost = current['cost'] + step['cost']
            if new_cost > mp_limit:
                continue
            neighbor_key = movement_state_key(neighbor['topLeft'], neighbor['size'])
            existing = best_cost.get(neighbor_key)
            if existing is not None and existing <= new_cost:
                continue
            best_cost[neighbor_key] = new_cost
            parent[neighbor_key] = current['key']
            queue.push({
                'key': neighbor_key,
                'topLeft': neighbor['topLeft'],
                'size': neighbor['size'],
                'cost': new_cost,
                'footprint': step['footprint'],
            })
    return {'nodes': nodes, 'cells': cells, 'parent': parent, 'maxMp': mp_limit}


def get_spaces_at_cost(cache: Dict[str, Any], mp_cost: int) -> List[str]:
    return [cell for cell, info in (cache.get('cells') or {}).items() if info['cost'] == mp_cost]


def get_movement_target(cache: Dict[str, Any], coord: str) -> Optional[Dict[str, Any]]:
    return (cache.get('cells') or {}).get(normalize_coord(coord))


def get_movement_path(cache: Dict[str, Any], start_coord: str, dest_top_left: str, dest_size: Optional[str], profile: MovementProfile) -> List[str]:
    """Path from start to dest_top_left via parent links. Returns list of
    topLeft coords in order."""
    if not cache or 'parent' not in cache:
        return []
    start_key = movement_state_key(normalize_coord(start_coord), profile.size)
    size_for_dest = dest_size or profile.size
    dest_key = movement_state_key(normalize_coord(dest_top_left), size_for_dest)
    path: List[str] = []
    key = dest_key
    safety = 0
    while key:
        safety += 1
        if safety > 10000:
            break
        node = (cache.get('nodes') or {}).get(key)
        if node is None:
            break
        path.insert(0, node['topLeft'])
        if key == start_key:
            break
        key = (cache.get('parent') or {}).get(key)
    return path


def get_reachable_spaces(start_coord: str, mp: int, map_spaces: Dict[str, Any], occupied_set: Optional[List[str]] = None) -> List[str]:
    """Default-profile 1x1 reachable cells. Mirrors JS signature."""
    board = build_temp_board_state(map_spaces, occupied_set or [], None)
    if not board or mp <= 0:
        return []
    profile = profile_from_size('1x1')
    cache = compute_movement_cache(start_coord, mp, board, profile)
    return list((cache.get('cells') or {}).keys())


def get_path_cost(start_coord: str, dest_coord: str, map_spaces: Dict[str, Any],
                   occupied_set: Optional[List[str]] = None,
                   hostile_occupied_set: Optional[List[str]] = None) -> float:
    """Default-profile 1x1 path cost; returns math.inf when unreachable.

    `occupied_set`: ALL occupied cells — checked for end-of-move (can't
    finish on an occupied cell).
    `hostile_occupied_set`: subset of `occupied_set` that blocks
    pass-through during traversal. Friendly figures occupy a cell (so
    end-of-move blocks) but the moving figure can pass through them
    (per IACP rules). When omitted, all occupied cells are treated as
    hostile (legacy behavior).
    """
    board = build_temp_board_state(map_spaces, occupied_set or [], hostile_occupied_set)
    if not board:
        return math.inf
    profile = profile_from_size('1x1')
    cache = compute_movement_cache(start_coord, 50, board, profile)
    target = (cache.get('cells') or {}).get(normalize_coord(dest_coord))
    return target['cost'] if target else math.inf
