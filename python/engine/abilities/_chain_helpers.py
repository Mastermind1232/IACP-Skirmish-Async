"""D3.13 — shared Pattern E chain-handler helpers.

Extracted on the third consumer (Hop On, `hop_on.py`) joining Force Push
(`force_push.py`, D3.8) and Force Throw (`force_throw.py`, D3.11). All three
chains resolve their `mapSpaces` from either an explicit ctx override or
`game.selectedMap.id` via `board_data.load_map_spaces`.

Prior to D3.13 each chain carried its own private `_resolve_map_spaces` with
identical behavior; the Force Throw docstring explicitly flagged the
duplication as pending a 3rd consumer. Hop On makes three, so the helper
lands here rather than each chain carrying its own copy.

Nothing else is extracted this slice. The other cross-chain similarities
(bolded-coord log format shared by Force Push + Hop On; footprint-based
occupied-set shared by Force Push + Hop On) still have only 2 consumers
and stay local to their original modules until a genuine 3rd consumer
justifies extraction.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from python.engine.board_data import load_map_spaces


def resolve_map_spaces(game: Dict[str, Any],
                       ctx: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Return ctx override if provided, else load via `game.selectedMap.id`.

    Returns None when neither is available or the loader raises. Callers
    handle None by emitting a manual-message payload.
    """
    if ctx.get('map_spaces') is not None:
        return ctx['map_spaces']
    selected_map = (game or {}).get('selectedMap') or {}
    map_id = selected_map.get('id')
    if not map_id:
        return None
    try:
        return load_map_spaces(map_id)
    except Exception:
        return None
