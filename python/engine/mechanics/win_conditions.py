"""Win-condition checker — port of src/engine/win-conditions.js.

Pure Python, no Discord deps. Called after every attack / objective-VP
grant to detect game-over events:

  - VP >= 40 for either side: higher VP wins, ties broken by kill VP.
  - Elimination: both sides at 0 figures → draw; one side at 0 → other wins.

On game over, sets:
  game['phase'] = 'game_over'
  game['gameEndedReason'] = '40 VP' | 'elimination' | 'draw (both eliminated)'
  game['winner'] = player_num (1 or 2) or None for draw
"""
from __future__ import annotations

from typing import Any, Dict, Optional


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(f'win_conditions expected GameState/dict, got {type(game).__name__}')


def _vp_total(data: Dict[str, Any], pn: int) -> int:
    key = 'player1VP' if pn == 1 else 'player2VP'
    vp = data.get(key) or {}
    return int(vp.get('total') or 0) if isinstance(vp, dict) else 0


def _kill_vp(data: Dict[str, Any], pn: int) -> int:
    key = 'player1VP' if pn == 1 else 'player2VP'
    vp = data.get(key) or {}
    return int(vp.get('kills') or 0) if isinstance(vp, dict) else 0


def _figure_count(data: Dict[str, Any], pn: int) -> int:
    fp = data.get('figurePositions') or {}
    p_map = fp.get(pn, fp.get(str(pn), {}))
    return len(p_map) if isinstance(p_map, dict) else 0


def check_win_conditions(game: Any) -> Dict[str, Any]:
    """Inspect game state for end-of-game conditions.

    Returns a result dict:
      { 'ended': bool, 'winner': Optional[int], 'reason': Optional[str] }

    When ended, mutates game['phase'] = 'game_over', sets 'winner' and
    'gameEndedReason' fields. Idempotent: if phase already 'game_over',
    returns the prior state without re-stamping.
    """
    data = _data(game)
    if data.get('phase') == 'game_over':
        return {
            'ended': True,
            'winner': data.get('winner'),
            'reason': data.get('gameEndedReason'),
        }

    vp1 = _vp_total(data, 1)
    vp2 = _vp_total(data, 2)
    f1 = _figure_count(data, 1)
    f2 = _figure_count(data, 2)

    winner: Optional[int] = None
    reason: Optional[str] = None

    if vp1 >= 40 or vp2 >= 40:
        if vp1 != vp2:
            winner = 1 if vp1 > vp2 else 2
            reason = f'40 VP ({vp1} vs {vp2})' if (vp1 >= 40 and vp2 >= 40) else '40 VP'
        else:
            # Tiebreaker 1: kill VP
            k1 = _kill_vp(data, 1)
            k2 = _kill_vp(data, 2)
            if k1 != k2:
                winner = 1 if k1 > k2 else 2
                reason = f'VP tiebreaker: kill VP ({k1} vs {k2}), tied at {vp1} VP'
            else:
                # Tiebreaker 2: damage received (lower wins)
                dmg = data.get('totalDamageReceived') or {}
                d1 = int(dmg.get(1, dmg.get('1', 0)) or 0)
                d2 = int(dmg.get(2, dmg.get('2', 0)) or 0)
                if d1 != d2:
                    winner = 1 if d1 < d2 else 2
                    reason = f'VP tiebreaker: damage received ({d1} vs {d2}), tied at {vp1} VP'
                else:
                    # Exhausted tiebreakers — deterministic fallback: P1 wins.
                    # (JS rolls a blue die; headless uses deterministic fallback
                    # since training needs reproducibility.)
                    winner = 1
                    reason = f'VP tiebreaker: exhausted, tied at {vp1} VP'
    elif f1 == 0 and f2 == 0:
        winner = None
        reason = 'draw (both eliminated)'
    elif f1 == 0:
        winner = 2
        reason = 'elimination'
    elif f2 == 0:
        winner = 1
        reason = 'elimination'

    if winner is not None or reason is not None:
        data['phase'] = 'game_over'
        data['winner'] = winner
        data['gameEndedReason'] = reason
        return {'ended': True, 'winner': winner, 'reason': reason}

    return {'ended': False}
