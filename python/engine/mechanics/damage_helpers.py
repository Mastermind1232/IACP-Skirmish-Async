"""D2.26 support — pure HP math helpers.

Byte-identical port of `reduce_hp` and `heal_hp` from
`src/game/damage-helpers.js`. Strain (D2.26), combat damage (D2.21/2.23), and
the defeat pipeline (D2.29) all funnel through here.

State shape (mirrors JS):
    dc_health_state         dict[str, list[list[int]]]
        # msgId → [[cur, max], [cur, max], ...] one entry per figure in the
        # group. JS uses a Map; Python uses a plain dict. Callers inject it
        # explicitly so the pure-engine surface stays stateless.
    game['p1DcList'] / game['p2DcList']
        # Redundant copy kept in game-state for Discord persistence. The sync
        # writes `healthState` back onto the matching DC entry. Defensive
        # no-op when dcList/dcIds are absent (tests can omit them).
    game['p1DcMessageIds'] / game['p2DcMessageIds']
        # msgId indexed by position in dcList.
    game['totalDamageReceived']   dict[int, int]
        # Tiebreaker tracking — populated only if the dict pre-exists.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _get_dc_list(game: Dict[str, Any], player_num: int) -> Optional[List[Any]]:
    return game.get('p1DcList' if player_num == 1 else 'p2DcList')


def _get_dc_message_ids(game: Dict[str, Any], player_num: int) -> Optional[List[str]]:
    return game.get('p1DcMessageIds' if player_num == 1 else 'p2DcMessageIds')


def _sync_dc_list(game: Dict[str, Any],
                  msg_id: str,
                  player_num: int,
                  health_state: List[List[int]]) -> None:
    """Copy health_state back to game.p1/p2DcList[idx].healthState.

    Mirrors the JS `syncDcList` defensive no-op branch: silently skips when
    dcList or dcIds are absent or msgId isn't in the list.
    """
    dc_ids = _get_dc_message_ids(game, player_num)
    dc_list = _get_dc_list(game, player_num)
    if not dc_ids or not dc_list:
        return
    try:
        idx = dc_ids.index(msg_id)
    except ValueError:
        return
    if idx < 0 or idx >= len(dc_list) or not dc_list[idx]:
        return
    entry = dc_list[idx]
    # dcList entries may be strings (just a name) or dicts — JS mutates only
    # when the entry has healthState-compatible shape.
    if isinstance(entry, dict):
        entry['healthState'] = [list(pair) for pair in health_state]


def reduce_hp(dc_health_state: Dict[str, List[List[int]]],
              game: Dict[str, Any],
              msg_id: str,
              figure_index: int,
              damage: int,
              player_num: int) -> Dict[str, Any]:
    """Reduce HP for a figure, clamped at 0.

    Mirrors `damage-helpers.js:reduceHp`. Returns
    `{newHp, maxHp, prevHp, wasDefeated}`. Returns zeros and False when the
    health state entry is missing or malformed — matches JS early-return.

    Syncs `dc_health_state[msg_id]` in place and mirrors into the DC list via
    `_sync_dc_list`. Populates `game['totalDamageReceived'][player_num]` only
    if the dict pre-exists (tiebreaker tracking is opt-in).
    """
    health_state = dc_health_state.get(msg_id)
    if not health_state or figure_index >= len(health_state):
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}
    entry = health_state[figure_index]
    if not isinstance(entry, list) or len(entry) < 2:
        return {'newHp': 0, 'maxHp': 0, 'prevHp': 0, 'wasDefeated': False}

    cur, max_hp_raw = entry[0], entry[1]
    prev_hp = cur if cur is not None else (max_hp_raw if max_hp_raw is not None else 0)
    max_hp = max_hp_raw if max_hp_raw is not None else (cur if cur is not None else 0)
    new_hp = max(0, prev_hp - damage)
    health_state[figure_index] = [new_hp, max_hp]
    dc_health_state[msg_id] = health_state
    _sync_dc_list(game, msg_id, player_num, health_state)

    actual_damage = prev_hp - new_hp
    if actual_damage > 0 and 'totalDamageReceived' in game and game['totalDamageReceived']:
        tdr = game['totalDamageReceived']
        tdr[player_num] = (tdr.get(player_num, 0) or 0) + actual_damage

    return {'newHp': new_hp, 'maxHp': max_hp, 'prevHp': prev_hp, 'wasDefeated': new_hp <= 0}


def heal_hp(dc_health_state: Dict[str, List[List[int]]],
            game: Dict[str, Any],
            msg_id: str,
            figure_index: int,
            amount: int,
            player_num: int) -> Dict[str, Any]:
    """Heal HP for a figure, clamped to max.

    Mirrors `damage-helpers.js:healHp`. Returns `{newHp, maxHp, healed}`.
    """
    health_state = dc_health_state.get(msg_id)
    if not health_state or figure_index >= len(health_state):
        return {'newHp': 0, 'maxHp': 0, 'healed': 0}
    entry = health_state[figure_index]
    if not isinstance(entry, list) or len(entry) < 2:
        return {'newHp': 0, 'maxHp': 0, 'healed': 0}

    cur, max_hp_raw = entry[0], entry[1]
    prev_hp = cur if cur is not None else (max_hp_raw if max_hp_raw is not None else 0)
    max_hp = max_hp_raw if max_hp_raw is not None else (cur if cur is not None else 0)
    new_hp = min(prev_hp + amount, max_hp)
    healed = new_hp - prev_hp
    health_state[figure_index] = [new_hp, max_hp]
    dc_health_state[msg_id] = health_state
    _sync_dc_list(game, msg_id, player_num, health_state)
    return {'newHp': new_hp, 'maxHp': max_hp, 'healed': healed}
