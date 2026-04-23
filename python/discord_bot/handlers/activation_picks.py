"""Activation picker validators — thin ports for ability-triggered picks.

Every handler validates owner + parses tail. Downstream resolution
(applying the picked ability / card / token) stays with the orchestrator.

  act_passive_{gameId}_{msgId}_{abilityId}_{selection}
  confirm_activate_{gameId}_{msgId}_{cardMsgId}
  field_tactics_pick_{gameId}_{tail}
  fv_pick_{gameId}_{tail}
  lia_deploy_zone_{gameId}_{tail}
  sc_fig_pick_{gameId}_{activatingMsgId}_{...}
  hair_trigger_use_{gameId}_{tail}
  iwba_use_{gameId}_{tail}
  iwba_pick_{gameId}_{tail}
  iwba_action_{gameId}_{tail}
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


def _make_game_tail_handler(prefix: str,
                              require_participant: bool = True
                              ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}[_{tail}] — optionally require participant."""
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

        if require_participant:
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


_handle_act_passive = _make_game_tail_handler('act_passive_')
_handle_confirm_activate = _make_game_tail_handler('confirm_activate_')
_handle_field_tactics_pick = _make_game_tail_handler('field_tactics_pick_')
_handle_fv_pick = _make_game_tail_handler('fv_pick_')
_handle_lia_deploy_zone = _make_game_tail_handler('lia_deploy_zone_')
_handle_sc_fig_pick = _make_game_tail_handler('sc_fig_pick_')
_handle_hair_trigger_use = _make_game_tail_handler('hair_trigger_use_')
_handle_iwba_use = _make_game_tail_handler('iwba_use_')
_handle_iwba_pick = _make_game_tail_handler('iwba_pick_')
_handle_iwba_action = _make_game_tail_handler('iwba_action_')


register('act_passive_', _handle_act_passive, 'core')
register('confirm_activate_', _handle_confirm_activate, 'core')
register('field_tactics_pick_', _handle_field_tactics_pick, 'core')
register('fv_pick_', _handle_fv_pick, 'core')
register('lia_deploy_zone_', _handle_lia_deploy_zone, 'core')
register('sc_fig_pick_', _handle_sc_fig_pick, 'core')
register('hair_trigger_use_', _handle_hair_trigger_use, 'core')
register('iwba_use_', _handle_iwba_use, 'core')
register('iwba_pick_', _handle_iwba_pick, 'core')
register('iwba_action_', _handle_iwba_action, 'core')
