"""Final batch of thin-validator Discord handlers.

Every remaining stub that fits the "validate participant + parse
tail" pattern gets a concrete validator here. Flows that need real
orchestrator integration (combat reroll continuation, bleed resolution,
dc_unactivate cleanup) still don't *do* the thing — but at least the
dispatch result carries a usable shape.

Categories (all use the same factory):
  - combat reactions / picks (bleed_accept/prevent, tough_luck_remove,
    there_is_no_try_die/face, deflect_pick, sidewinder_apply,
    spread_pain_fig, boltslinger_target, fighting_knife_target,
    indiscriminate_die, havoc_shot_*, heavy_fire_*, wanton_*,
    concussive_bolt_push)
  - map events (devaron_door_open, devaron_crate_push,
    fluctuation_swap, krykna_push, krykna_place, krykna_place_pick)
  - move chain (move_pick, move_adjust_mp, massive_push_*,
    mvint_play, ow_interrupt_use, dio_follow_pick)
  - dc-play-area (dc_attack, dc_move, dc_interact, dc_spend_mp,
    dc_unactivate, dc_toggle, dc_rename, dc_cc_eoa, ob_deplete,
    rush_push_space, shoulder_rush_space)
  - admin / destructive (botmenu_kill_yes, botmenu_recover, kill_game,
    forfeit, forfeit_yes)
  - negation / cc_play / cc_attach_to
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
    """{prefix}{gameId}[_{tail}] — participant-gated."""
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


def _make_msg_id_validator(prefix: str
                              ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{msgId}[_{tail}] — participant-gated via dc_message_meta lookup.

    Used for dc_* prefixes where the customId carries msgId (not gameId)
    as the first segment.
    """
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)(?:_(.+))?$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        msg_id = m.group(1)
        tail = m.group(2) or ''

        dcm = ctx.get('dc_message_meta') or {}
        meta = dcm.get(msg_id) if hasattr(dcm, 'get') else None
        if not meta:
            return {'ok': False, 'reason': 'msg_id_meta_missing'}
        game_id = meta.get('gameId')
        player_num = meta.get('playerNum')
        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

        data = game.data if hasattr(game, 'data') else game
        user_id = _uid(interaction)
        owner_id = data.get(f'player{player_num}Id')
        if user_id and str(user_id) != str(owner_id or ''):
            return {'ok': False, 'reason': 'not_owner'}
        return {
            'ok': True, 'game': game, 'gameId': game_id, 'msgId': msg_id,
            'playerNum': player_num, 'tail': tail,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


# Game-id-keyed: customId = {prefix}{gameId}[_{tail}]
_GAME_KEYED = [
    'bleed_accept_', 'bleed_prevent_',
    'boltslinger_target_',
    'concussive_bolt_push_',
    'deflect_pick_',
    'devaron_door_open_',  # devaron_crate_push_ handled in map_events.py
    'dio_follow_pick_',
    'fighting_knife_target_',
    'fluctuation_swap_',
    'havoc_shot_done_', 'havoc_shot_pick_', 'havoc_shot_use_',
    'heavy_fire_cond_', 'heavy_fire_tgt_', 'heavy_fire_tgt_done_',
    'heavy_fire_use_',
    'indiscriminate_die_',
    'krykna_place_', 'krykna_place_pick_',  # krykna_push_ handled in map_events.py
    'massive_push_figure_', 'massive_push_space_',
    'move_pick_',
    'mvint_play_',
    'negation_play_',
    'ow_interrupt_use_',
    'rush_push_space_',
    'shoulder_rush_space_',
    'sidewinder_apply_',
    'spread_pain_fig_',
    'there_is_no_try_die_', 'there_is_no_try_face_',
    'tough_luck_remove_',
    'wanton_cc_', 'wanton_done_', 'wanton_pick_', 'wanton_use_',
    'cc_attach_to_', 'cc_play_',
    'kill_game_',
    'botmenu_kill_yes_', 'botmenu_recover_',
    'forfeit_', 'forfeit_yes_',
    'ob_deplete_',
]


# Msg-id-keyed: customId = {prefix}{msgId}[_{tail}]
_MSG_KEYED = [
    'dc_attack_', 'dc_move_', 'dc_interact_', 'dc_spend_mp_',
    'dc_unactivate_', 'dc_toggle_', 'dc_rename_', 'dc_cc_eoa_',
    'move_adjust_mp_',
]


_handlers: Dict[str, Any] = {}
for _p in _GAME_KEYED:
    _h = _make_game_tail_validator(_p)
    _handlers[_p] = _h
    register(_p, _h, 'core')

for _p in _MSG_KEYED:
    _h = _make_msg_id_validator(_p)
    _handlers[_p] = _h
    register(_p, _h, 'core')
