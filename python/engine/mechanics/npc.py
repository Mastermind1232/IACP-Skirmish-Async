"""NPC lifecycle helpers — Python mirror of NPC-specific JS logic.

Scope: the non-player entities whose state lives on the game object
outside a DC structure.

Ports of activation/movement/damage-emit logic live in mission_rules
(run_npc_krykna_activation, run_npc_thug_activation,
get_valid_krykna_placement_spaces) — they're co-located with the
data-driven mission rules because lazy-init pulls from map-tokens.json.
This module owns the damage-resolution leaf used by round.js + combat-
bridge.js when an NPC source (thug / Krykna / crate explosion) hits a
player-owned figure.

Public API:
  apply_npc_damage_to_figure(game, player_num, figure_key, damage,
                              source_label, dc_health_state,
                              dc_message_meta=None)
      → {'applied', 'newHp', 'maxHp', 'wasDefeated', 'msgId', 'logMessage'}
      Reduces HP via damage_helpers.reduce_hp. Does NOT process defeat
      (Phase 7 defeat handler owns that — VP awards, condition cleanup,
      Nefarious Gains). Returns wasDefeated so caller can invoke the
      defeat pipeline.

  find_dc_msg_id_for_figure(game, player_num, figure_key, dc_message_meta)
      → Optional[str]
      Locates the DC message-id for a figure via the DG-index suffix.
      Separated out so tests can stub dc_message_meta cleanly.

For Wampa and Nexu (regular DCs with special passives), no separate
lifecycle logic is required — their activation passives are in
activation_effects (Hunger) and combat.py (standard DC behavior).
"""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Optional, Tuple

from python.engine.mechanics.damage_helpers import reduce_hp
from python.engine.mechanics.dc_helpers import (
    dc_name_from_figure_key,
    parse_figure_key,
)


_DG_RE = re.compile(r'\[(?:DG|Group) (\d+)\]')


def _data(game: Any) -> Dict[str, Any]:
    data_attr = getattr(game, 'data', None)
    if isinstance(data_attr, dict):
        return data_attr
    if isinstance(game, dict):
        return game
    raise TypeError(
        f'npc expected GameState or dict, got {type(game).__name__}'
    )


def find_dc_msg_id_for_figure(game: Any, player_num: int, figure_key: str,
                              dc_message_meta: Optional[Iterable[Tuple[str, Dict[str, Any]]]],
                              ) -> Optional[str]:
    """Look up msgId by (gameId, playerNum, dcName, dgIndex).

    dc_message_meta is an iterable of (msgId, meta) pairs. Each meta
    contains gameId, playerNum, dcName, displayName. Mirrors the
    Discord-side Map<msgId, meta> registry.
    """
    if not dc_message_meta:
        return None
    data = _data(game)
    dc_name = dc_name_from_figure_key(figure_key)
    parsed = parse_figure_key(figure_key)
    dg_index = str(parsed.get('dgIndex', 1))
    game_id = data.get('gameId')
    for mid, meta in dc_message_meta:
        if not isinstance(meta, dict):
            continue
        if meta.get('gameId') != game_id:
            continue
        if meta.get('playerNum') != player_num:
            continue
        if meta.get('dcName') != dc_name:
            continue
        display = str(meta.get('displayName') or '')
        m = _DG_RE.search(display)
        meta_dg = m.group(1) if m else '1'
        if meta_dg == dg_index:
            return mid
    return None


def apply_npc_damage_to_figure(game: Any, player_num: int, figure_key: str,
                                damage: int, source_label: str,
                                dc_health_state: Dict[str, Any],
                                dc_message_meta: Optional[Iterable[Tuple[str, Dict[str, Any]]]] = None,
                                ) -> Dict[str, Any]:
    """Apply NPC damage to a player-owned figure.

    Returns {'applied', 'newHp', 'maxHp', 'wasDefeated', 'msgId', 'logMessage'}.
    Caller is responsible for driving the defeat pipeline when
    wasDefeated=True (VP, condition cleanup, Nefarious Gains).

    If msgId can't be resolved (figure not in dc_message_meta), returns
    applied=False with a fallback log message — mirrors JS behavior where
    the handler posts "update manually" when it can't find the DC in
    memory.
    """
    data = _data(game)
    dc_name = dc_name_from_figure_key(figure_key)
    parsed = parse_figure_key(figure_key)
    figure_index = parsed.get('figureIndex', 0)

    msg_id = find_dc_msg_id_for_figure(game, player_num, figure_key, dc_message_meta)

    if not msg_id:
        return {
            'applied': False,
            'newHp': None,
            'maxHp': None,
            'wasDefeated': False,
            'msgId': None,
            'logMessage': (
                f'**{source_label}:** **{dc_name}** suffered **{damage} damage** '
                f'(HP not found in memory — update DC card manually).'
            ),
        }

    result = reduce_hp(dc_health_state, data, msg_id, figure_index, damage, player_num)
    new_hp = result['newHp']
    max_hp = result['maxHp']
    was_defeated = result['wasDefeated']

    # Entry must exist in health state for the mutation to have taken effect
    hs = dc_health_state.get(msg_id)
    entry_valid = bool(hs and figure_index < len(hs))

    if not entry_valid:
        return {
            'applied': False, 'newHp': new_hp, 'maxHp': max_hp,
            'wasDefeated': False, 'msgId': msg_id,
            'logMessage': (
                f'**{source_label}:** **{dc_name}** suffered **{damage} damage** '
                f'(HP not found in memory — update DC card manually).'
            ),
        }

    if was_defeated:
        log = f'**{source_label}:** **{dc_name}** was **defeated**.'
    else:
        log = (
            f'**{source_label}:** **{dc_name}** suffered **{damage} damage** '
            f'({new_hp}/{max_hp} HP remaining).'
        )

    return {
        'applied': True, 'newHp': new_hp, 'maxHp': max_hp,
        'wasDefeated': was_defeated, 'msgId': msg_id,
        'logMessage': log,
    }
