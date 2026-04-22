"""Deterministic start/end-of-round DC-passive effects.

Python mirror of the start-of-round / end-of-round DC walks in
src/handlers/round.js. No Discord dependency; returns an effect log
the caller can surface as embed / console output.

Scope seed (matches the JS file branch-by-branch; each new lane lands
in its own PR with an oracle):

  apply_start_of_round_dc_effects:
    - Brush (Ezra Bridger)        → +4 MP to Ezra's DC msg_id

  apply_end_of_round_dc_effects:
    (none yet — placeholder for future lanes)
"""
from __future__ import annotations

from typing import Any, Dict, List

from python.engine.data.dc_effects_loader import get_dc_effect
from python.engine.mechanics.game_helpers import grant_movement_bank
from python.engine.mechanics.player_helpers import (
    get_dc_list, get_dc_message_ids,
)


def apply_start_of_round_dc_effects(game: Any) -> List[Dict[str, Any]]:
    """Walk both players' DC lists at start-of-round and fire each DC's
    start-of-round passive. Returns a list of applied-effect entries.

    JS site: src/handlers/round.js:1080-1200 (startOfRound DC walks).
    Mutates `game.data` in place.
    """
    events: List[Dict[str, Any]] = []
    data = game.data if hasattr(game, 'data') else game
    for player_num in (1, 2):
        dc_list = get_dc_list(data, player_num) or []
        msg_ids = get_dc_message_ids(data, player_num) or []
        for i, dc in enumerate(dc_list):
            if not dc or dc.get('defeated'):
                continue
            dc_name = dc.get('dcName') or ''
            if not dc_name:
                continue
            effect = get_dc_effect(dc_name) or {}
            ability_ids = effect.get('specialAbilityIds') or []
            if not isinstance(ability_ids, list):
                continue
            msg_id = msg_ids[i] if i < len(msg_ids) else None
            if not msg_id:
                continue
            # Brush (Ezra Bridger) — +4 MP at start of round
            if 'brush_ezra' in ability_ids:
                grant_movement_bank(game, msg_id, 4)
                events.append({
                    'abilityId': 'brush_ezra',
                    'playerNum': player_num,
                    'msgId': msg_id,
                    'dcName': dc_name,
                    'mpGranted': 4,
                    'message': (
                        f'**Brush** — **{dc_name}** gains **4 MP** at the start of the round.'
                    ),
                })
    return events


def apply_end_of_round_dc_effects(game: Any) -> List[Dict[str, Any]]:
    """Placeholder for end-of-round DC passives. Returns empty list
    until a handler lands. Keeps the API symmetric with the start-of-round
    walker.
    """
    return []
