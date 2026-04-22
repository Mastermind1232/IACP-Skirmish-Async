"""Board-state + profile helpers for Python movement (D2.7 support).

Port of pure-geometry pieces of `src/game/movement.js`:
  - buildTempBoardState  → build_temp_board_state
  - movementStateKey     → movement_state_key
  - getNormalizedFootprint → get_normalized_footprint
  - MovementProfile dataclass (simplified — DC-keyword lookup defers to D4)

This module does NOT touch DC data-loader, game handlers, or card library.
It operates on synthetic or pre-filtered board-state dicts only, so parity
with JS can be verified without wiring the rest of the engine.
"""
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Optional, Set

from python.engine.mechanics.coords import (
    edge_key,
    get_footprint_cells,
    normalize_coord,
    to_lower_set,
)


@dataclass
class MovementProfile:
    """Mirrors JS profile dict shape. Kept as a dataclass for auto-repr +
    easier construction in tests. Full DC-keyword-driven construction belongs
    to D4 (getMovementProfile equivalent); this dataclass is the consumer side.
    """
    size: str = '1x1'
    cols: int = 1
    rows: int = 1
    is_large: bool = False
    allow_diagonal: bool = True
    can_rotate: bool = False
    is_massive: bool = False
    is_mobile: bool = False
    ignore_difficult: bool = False
    ignore_blocking: bool = False
    ignore_figure_cost: bool = False
    can_end_on_occupied: bool = False
    treat_blocking_as_difficult: bool = False

    def as_js_dict(self) -> Dict[str, Any]:
        """Dict shape mirroring JS profile for test-fixture compatibility."""
        return {
            'size': self.size,
            'cols': self.cols,
            'rows': self.rows,
            'isLarge': self.is_large,
            'allowDiagonal': self.allow_diagonal,
            'canRotate': self.can_rotate,
            'isMassive': self.is_massive,
            'isMobile': self.is_mobile,
            'ignoreDifficult': self.ignore_difficult,
            'ignoreBlocking': self.ignore_blocking,
            'ignoreFigureCost': self.ignore_figure_cost,
            'canEndOnOccupied': self.can_end_on_occupied,
            'treatBlockingAsDifficult': self.treat_blocking_as_difficult,
        }


def profile_from_size(size: str, **flags: Any) -> MovementProfile:
    """Build a MovementProfile from a size string + optional flag overrides.

    Computes cols/rows/is_large/allow_diagonal/can_rotate from size directly so
    callers only need to specify mechanics flags (ignore_difficult, is_massive…).
    """
    parts = str(size or '1x1').split('x')
    try:
        cols = max(1, int(parts[0]))
    except (ValueError, IndexError):
        cols = 1
    try:
        rows = max(1, int(parts[1])) if len(parts) > 1 else 1
    except ValueError:
        rows = 1
    prof = MovementProfile(
        size=f'{cols}x{rows}',
        cols=cols,
        rows=rows,
        is_large=(cols != 1 or rows != 1),
        allow_diagonal=(cols == 1 and rows == 1),
        can_rotate=(cols != rows),
    )
    for k, v in flags.items():
        if hasattr(prof, k):
            setattr(prof, k, v)
    return prof


def get_normalized_footprint(top_left: str, size: str) -> List[str]:
    """Normalized footprint cells for a figure with given topLeft + size."""
    return [normalize_coord(c) for c in get_footprint_cells(top_left, size)]


def movement_state_key(coord: str, size: str) -> str:
    """Stable state-key string: `{normalized coord}|{size}`."""
    return f'{normalize_coord(coord)}|{size}'


def build_temp_board_state(
    map_spaces: Dict[str, Any],
    occupied_set: Optional[Iterable[str]] = None,
    hostile_occupied_set: Optional[Iterable[str]] = None,
    massive_occupied_set: Optional[Iterable[str]] = None,
) -> Optional[Dict[str, Any]]:
    """Port of JS `buildTempBoardState`.

    Accepts optional occupied / hostile / massive sets. The JS version only
    passed `game` for Wasskah breakable-wall filtering; Python callers in the
    pure-engine slice handle impassable-edge filtering upstream, so we accept
    `map_spaces.impassableEdges` as-is (already filtered if needed).
    """
    if not map_spaces:
        return None
    blocking_set = to_lower_set(map_spaces.get('blocking') or [])
    spaces_set = to_lower_set(map_spaces.get('spaces') or [])
    terrain: Dict[str, str] = {}
    for coord, ttype in (map_spaces.get('terrain') or {}).items():
        terrain[normalize_coord(coord)] = str(ttype or 'normal').lower()
    adjacency: Dict[str, List[str]] = {}
    for coord, neighbors in (map_spaces.get('adjacency') or {}).items():
        adjacency[normalize_coord(coord)] = [normalize_coord(n) for n in (neighbors or [])]
    movement_blocking_set: Set[str] = set()
    for edge in (map_spaces.get('movementBlockingEdges') or []):
        if edge and len(edge) >= 2:
            movement_blocking_set.add(edge_key(edge[0], edge[1]))
    for edge in (map_spaces.get('impassableEdges') or []):
        if edge and len(edge) >= 2:
            movement_blocking_set.add(edge_key(edge[0], edge[1]))

    board: Dict[str, Any] = {
        'mapSpaces': map_spaces,
        'adjacency': adjacency,
        'terrain': terrain,
        'blockingSet': blocking_set,
        'occupiedSet': {normalize_coord(s) for s in (occupied_set or [])},
        'movementBlockingSet': movement_blocking_set,
        'spacesSet': spaces_set,
    }
    if hostile_occupied_set is not None:
        board['hostileOccupiedSet'] = {normalize_coord(s) for s in (hostile_occupied_set or [])}
    if massive_occupied_set is not None:
        board['massiveOccupiedSet'] = {normalize_coord(s) for s in (massive_occupied_set or [])}
    return board
