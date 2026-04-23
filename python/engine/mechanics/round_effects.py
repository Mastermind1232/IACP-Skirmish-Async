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
from python.engine.mechanics.conditions import filter_condition
from python.engine.mechanics.damage_helpers import heal_hp
from python.engine.mechanics.game_helpers import grant_movement_bank
from python.engine.mechanics.player_helpers import (
    get_dc_list, get_dc_message_ids,
)


def _heal_distributed(dc_health_state: Dict[str, Any], game_data: Any,
                       msg_id: str, amount: int, player_num: int) -> int:
    """Spread `amount` HP recovery across a DC's figures, filling each to
    max before moving on. Returns total HP recovered.
    """
    health_state = dc_health_state.get(msg_id)
    if not isinstance(health_state, list):
        return 0
    remaining = amount
    total = 0
    for idx in range(len(health_state)):
        if remaining <= 0:
            break
        entry = health_state[idx]
        if not isinstance(entry, list) or len(entry) < 2:
            continue
        cur = entry[0]
        max_hp = entry[1]
        if cur is None or max_hp is None or cur >= max_hp:
            continue
        res = heal_hp(dc_health_state, game_data, msg_id, idx, remaining, player_num)
        healed = res.get('healed') or 0
        remaining -= healed
        total += healed
    return total


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
            # Fire all other Pattern D start-of-round triggers.
            try:
                from python.engine.abilities.pattern_d import fire_ability
                from python.engine.data.ability_library_loader import (
                    get_ability,
                )
                for aid in ability_ids:
                    if aid == 'brush_ezra':
                        continue
                    abil_entry = get_ability(aid) or {}
                    if abil_entry.get('trigger') == 'start-of-round':
                        try:
                            fire_ability(data, aid, {
                                'figure_key': f'{dc_name}-{dc.get("dgIndex", 0)}-0',
                                'msg_id': msg_id,
                                'player_num': player_num,
                                'trigger': 'start-of-round',
                            })
                            events.append({
                                'abilityId': aid,
                                'playerNum': player_num,
                                'msgId': msg_id,
                                'dcName': dc_name,
                                'trigger': 'start-of-round',
                            })
                        except NotImplementedError:
                            pass
            except Exception:
                pass
    return events


def apply_end_of_round_dc_effects(game: Any) -> List[Dict[str, Any]]:
    """Walk both players' DCs at end-of-round and fire each DC's
    end-of-round passive. Returns a list of applied-effect entries.

    JS site: src/handlers/round.js:347-440 (end-of-round DC walks).
    """
    events: List[Dict[str, Any]] = []
    data = game.data if hasattr(game, 'data') else game
    dc_health_state = data.get('dcHealthState') or {}

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

            # Regenerate (Bossk): recover 2 HP distributed across figures +
            # discard Bleed from all figures of the DC.
            if 'regenerate_bossk' in ability_ids:
                recovered = _heal_distributed(
                    dc_health_state, data, msg_id, 2, player_num,
                )
                bleed_cleared_keys = []
                fc = data.get('figureConditions') or {}
                for fk in list(fc.keys()):
                    if not fk.startswith(dc_name + '-'):
                        continue
                    before = len(fc.get(fk) or [])
                    filter_condition(data, fk, 'Bleed')
                    after = len((data.get('figureConditions') or {}).get(fk) or [])
                    if after < before:
                        bleed_cleared_keys.append(fk)
                events.append({
                    'abilityId': 'regenerate_bossk',
                    'playerNum': player_num,
                    'msgId': msg_id,
                    'dcName': dc_name,
                    'hpRecovered': recovered,
                    'bleedCleared': bleed_cleared_keys,
                    'message': (
                        f'**Regenerate** — **{dc_name}** recovered {recovered} HP'
                        + (f' and cleared Bleed from {len(bleed_cleared_keys)} figure(s).'
                           if bleed_cleared_keys else '.')
                    ),
                })

    return events
