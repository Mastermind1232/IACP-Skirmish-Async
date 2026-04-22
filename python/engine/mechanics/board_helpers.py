"""Pure board-state helpers — Python mirror of src/game/board-helpers.js.

Leaf-scope subset for M3-G (activation_effects) and downstream mechanics:
  - get_closed_door_edges(game) → Set[edgeKey]
  - count_game_spaces(game, coord_a, coord_b) → graph-distance respecting closed doors

Heavier helpers from board-helpers.js (getLegalInteractOptions,
getSpaceController, countTerminalsControlledByPlayer, Alter Mind /
Powerful Influence exclusions) land with M3-J / M3-L — they pull in
mission-rules + CC deps not needed for activation_effects.
"""
from __future__ import annotations

from typing import Any, Dict, Optional, Set

from python.engine.data.map_spaces_loader import get_map_spaces
from python.engine.data.map_tokens_loader import get_map_tokens_data
from python.engine.mechanics.coords import edge_key
from python.engine.mechanics.spatial import INFINITY, count_spaces


def get_closed_door_edges(game: Any) -> Set[str]:
    """Set of edge-key strings for doors that are NOT yet opened.

    Mirrors src/game/board-helpers.js:getClosedDoorEdges. Opened doors
    are looked up in both orientations because openedDoors entries may
    be recorded in either order.
    """
    data = _data(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    if not map_id:
        return set()
    all_doors = (get_map_tokens_data().get(map_id) or {}).get('doors') or []
    if not all_doors:
        return set()
    opened_set = {str(k).lower() for k in (data.get('openedDoors') or [])}
    closed: Set[str] = set()
    for edge in all_doors:
        a = str(edge[0]).lower()
        b = str(edge[1]).lower()
        if f'{a}|{b}' in opened_set or f'{b}|{a}' in opened_set:
            continue
        closed.add(edge_key(edge[0], edge[1]))
    return closed


def count_game_spaces(game: Any, coord_a: str, coord_b: str) -> float:
    """Graph distance between two spaces, respecting closed doors.

    Returns math.inf if either coord is missing / map not loaded or if
    the target is unreachable under the closed-door edge set.
    """
    data = _data(game)
    selected = data.get('selectedMap') or {}
    map_id = selected.get('id') if isinstance(selected, dict) else None
    ms = get_map_spaces(map_id) if map_id else None
    if not ms:
        return INFINITY
    return count_spaces(ms, coord_a, coord_b, get_closed_door_edges(game))


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'board_helpers expected GameState or dict, got {type(game).__name__}'
    )
