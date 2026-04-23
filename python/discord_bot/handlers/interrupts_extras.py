"""Interrupt / post-combat / reaction picker validators.

Every handler validates participant + parses tail. Downstream combat
effect resolution stays in the orchestrator port.

  still_faster_use_{gameId}_{tail}
  still_faster_dc_pick_{gameId}_{tail}
  squad_swarm_yes_{gameId}_{tail}
  overdrive_use_{gameId}
  self_destruct_probe_use_{gameId}
  self_destruct_protocol_use_{gameId}
  last_resort_use_{gameId}
  submit_fight_use_{gameId}
  scavenged_walker_attack_{gameId}
  dbh_force_choke_{gameId}
  dbh_attack_{gameId}
  on_diplomatic_{gameId}
  bel_reorder_1_{gameId}_{tail}
  bel_reorder_2_{gameId}_{tail}
  ab_blade_pick_{gameId}_{tail}
  sf_mp_pick_{gameId}_{tail}
  ps_replace_{gameId}_{tail}
  force_slow_pick_{gameId}_{tail}
  excavation_pick_{gameId}_{tail}
  bm_draw_{gameId}_{tail}
  bm_discard_{gameId}_{tail}
  bm_return_{gameId}_{tail}
  executor_use_{gameId}
  extra_protection_play_{gameId}
  yhsiw_transfer_{gameId}_{tail}
  yhsiw_damage_{gameId}_{tail}
  reaction_use_{gameId}
  right_back_block_{gameId}
  right_back_nodmg_{gameId}
  mastery_pick_{gameId}_{tail}
  interrogate_pick_{gameId}_{tail}
  interrogate_discard_{gameId}_{tail}
  vet_instincts_pick_{gameId}_{tail}
  hunter_protocol_trigger_{gameId}
  strike_me_down_yes_{gameId}
  slow_on_draw_yes_{gameId}
  slow_on_draw_resume_{gameId}
  power_converter_approve_{gameId}_{tail}
  power_converter_die_{gameId}_{tail}
  power_converter_color_{gameId}_{tail}
  illicit_arms_use_{gameId}_{tail}
  illicit_arms_pick_{gameId}_{tail}
  force_exhaustion_yes_{gameId}_{tail}
  doubt_reroll_use_{gameId}_{tail}
  doubt_fig_{gameId}_{tail}
  ctf_pick_{gameId}_{tail}
  ctf_strain_{gameId}_{tail}
"""
from __future__ import annotations

import re
from typing import Any, Callable, Dict

from python.discord_bot.handlers import register


def _cid(interaction: Any) -> str:
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    return (
        getattr(interaction, 'customId', None)
        or getattr(interaction, 'custom_id', None)
        or ''
    )


def _uid(interaction: Any) -> str:
    user = getattr(interaction, 'user', None)
    if user is not None:
        uid = getattr(user, 'id', None)
        if uid is not None:
            return str(uid)
    return ''


def _make_game_tail_validator(prefix: str
                                 ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)(?:_(.+))?$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = m.group(1)
        tail = m.group(2) or ''
        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        user_id = _uid(interaction)
        if user_id and str(user_id) not in (
            str(data.get('player1Id') or ''),
            str(data.get('player2Id') or ''),
        ):
            return {'ok': False, 'reason': 'not_a_player_in_game'}
        return {
            'ok': True, 'game': game, 'gameId': game_id, 'tail': tail,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_PREFIXES = [
    'still_faster_use_', 'still_faster_dc_pick_',
    'squad_swarm_yes_',
    'overdrive_use_',
    'self_destruct_probe_use_', 'self_destruct_protocol_use_',
    'last_resort_use_',
    'submit_fight_use_',
    'scavenged_walker_attack_',
    'dbh_force_choke_', 'dbh_attack_',
    'on_diplomatic_',
    'bel_reorder_1_', 'bel_reorder_2_',
    'ab_blade_pick_', 'sf_mp_pick_', 'ps_replace_',
    'force_slow_pick_', 'excavation_pick_',
    'bm_draw_', 'bm_discard_', 'bm_return_',
    'executor_use_',
    'extra_protection_play_',
    'yhsiw_transfer_', 'yhsiw_damage_',
    # reaction_use_, right_back_*, mastery_pick_, interrogate_pick_/discard_
    # handled concretely in post_combat.py.
    'vet_instincts_pick_',
    'hunter_protocol_trigger_',
    'strike_me_down_yes_',
    'slow_on_draw_yes_', 'slow_on_draw_resume_',
    'power_converter_approve_', 'power_converter_die_',
    'power_converter_color_',
    'illicit_arms_use_', 'illicit_arms_pick_',
    'force_exhaustion_yes_',
    'doubt_reroll_use_',
    'doubt_fig_',
    'ctf_pick_', 'ctf_strain_',
]


_handlers: Dict[str, Any] = {}
for _p in _PREFIXES:
    _h = _make_game_tail_validator(_p)
    _handlers[_p] = _h
    register(_p, _h, 'core')
