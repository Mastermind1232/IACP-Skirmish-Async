"""Shared game-state mutation helpers — mirror of src/game/game-helpers.js.

This module owns the cross-cutting mutation helpers that multiple
mechanics modules call into. Specifically:

  grant_movement_bank(game, msg_id, amount)
      Adds MP to `game['movementBank'][msg_id]`, initializing the
      per-DC entry if missing. Used by start-of-activation effects
      (Mounted, Into the Fray, Focused on the Kill, Beast Tamer).

  get_player_deployment_zones(game, initiative_player_num)
      Computes per-player zone assignments from the chosen color and
      initiative. Used by mission rules (vpPerControlledDeploymentZone)
      and setup flow.

Power-token grant / overflow helpers (`grant_power_tokens`,
`resolve_overflow_discard`) already live in `python/engine/mechanics/
tokens.py`; this module does NOT duplicate them. The JS analogue
keeps them in one file; Python split them for clarity since tokens.py
was ported first.
"""
from __future__ import annotations

from typing import Any, Dict


def grant_movement_bank(game: Any, msg_id: str, amount: int) -> None:
    """Add `amount` MP to the bank for DC-message `msg_id`.

    Initializes `game['movementBank']` and the per-msgId entry if they
    don't exist. No-op when `msg_id` falsy or `amount` falsy (zero).
    Mirrors src/game/game-helpers.js:grantMovementBank byte-for-byte.
    """
    if not msg_id or not amount:
        return
    data = _data(game)
    bank = data.get('movementBank')
    if not isinstance(bank, dict):
        bank = {}
        data['movementBank'] = bank
    entry = bank.get(msg_id)
    if not isinstance(entry, dict):
        entry = {'total': 0, 'remaining': 0}
        bank[msg_id] = entry
    entry['total'] = int(entry.get('total') or 0) + amount
    entry['remaining'] = int(entry.get('remaining') or 0) + amount


def get_player_deployment_zones(game: Any, initiative_player_num: int) -> Dict[str, str]:
    """Return `{'p1Zone': 'red'|'blue', 'p2Zone': 'red'|'blue'}`.

    Assigns the chosen zone color to the initiative player; the other
    player gets the opposite color. Mirrors
    src/game/game-helpers.js:getPlayerDeploymentZones.
    """
    data = _data(game)
    chosen = data.get('deploymentZoneChosen')
    other = 'blue' if chosen == 'red' else 'red'
    p1_zone = chosen if initiative_player_num == 1 else other
    p2_zone = 'blue' if p1_zone == 'red' else 'red'
    return {'p1Zone': p1_zone, 'p2Zone': p2_zone}


# ---------------------------------------------------------------------------

def _data(game: Any) -> Dict[str, Any]:
    """Unwrap GameState → dict if needed. Tolerates plain dicts too."""
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'game_helpers expected GameState or dict, got {type(game).__name__}'
    )
