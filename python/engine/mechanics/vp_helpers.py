"""Pure VP mutation helpers — mirror of src/game/vp-helpers.js.

Operates on `game['player1VP']` / `game['player2VP']` dicts of shape
`{'total': n, 'kills': n, 'objectives': n}`. Initializes the dict on
first write. No Discord dependency.
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'vp_helpers expected GameState or dict, got {type(game).__name__}'
    )


def _ensure_vp(game: Any, player_num: int) -> Dict[str, int]:
    data = _data(game)
    key = 'player1VP' if player_num == 1 else 'player2VP'
    existing = data.get(key)
    if not isinstance(existing, dict):
        existing = {'total': 0, 'kills': 0, 'objectives': 0}
        data[key] = existing
    return existing


def award_kill_vp(game: Any, player_num: int, amount: int) -> None:
    """Award VP for a figure kill — increments kills + total."""
    vp = _ensure_vp(game, player_num)
    vp['kills'] = (vp.get('kills') or 0) + amount
    vp['total'] = (vp.get('total') or 0) + amount


def award_objective_vp(game: Any, player_num: int, amount: int) -> None:
    """Award VP for an objective (mission, surge, etc.) — increments objectives + total."""
    vp = _ensure_vp(game, player_num)
    vp['objectives'] = (vp.get('objectives') or 0) + amount
    vp['total'] = (vp.get('total') or 0) + amount


def check_nefarious_gains(game: Any, defeated_owner_pn: int) -> Optional[Dict[str, Any]]:
    """Award 1 objective VP to the opposing player if Jabba is alive.

    Returns {'jabbaOwnerPN', 'vpTotal'} on award, None if Jabba not found.
    """
    data = _data(game)
    jabba_owner_pn = 2 if defeated_owner_pn == 1 else 1
    positions = (data.get('figurePositions') or {}).get(jabba_owner_pn) or {}
    jabba_alive = any(fk.startswith('Jabba the Hutt-') for fk in positions)
    if not jabba_alive:
        return None
    award_objective_vp(game, jabba_owner_pn, 1)
    vp_key = 'player1VP' if jabba_owner_pn == 1 else 'player2VP'
    return {
        'jabbaOwnerPN': jabba_owner_pn,
        'vpTotal': (data.get(vp_key) or {}).get('total', 0),
    }


def deduct_vp(game: Any, player_num: int, amount: int) -> None:
    """Deduct VP (clamped to 0); objectives first, then kills; total clamped."""
    vp = _ensure_vp(game, player_num)
    remaining = amount
    obj_deduct = min(vp.get('objectives') or 0, remaining)
    vp['objectives'] = (vp.get('objectives') or 0) - obj_deduct
    remaining -= obj_deduct
    if remaining > 0:
        vp['kills'] = max(0, (vp.get('kills') or 0) - remaining)
    vp['total'] = max(0, (vp.get('total') or 0) - amount)
