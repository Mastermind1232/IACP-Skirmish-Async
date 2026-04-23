"""Blitz deploy Discord handlers — thin validators.

  blitz_group_{gameId}_{playerNum}_{groupIdx}
  blitz_pass_{gameId}_{playerNum}
  blitz_move_fig_{gameId}_{playerNum}_{figureKey}
  blitz_move_pick_{gameId}_{playerNum}_{space}
  blitz_move_done_{gameId}_{playerNum}
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


def _make_blitz_handler(prefix: str
                          ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}_{playerNum}[_{tail}] with blitzDeployment gate."""
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)_([12])(?:_(.+))?$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = m.group(1)
        player_num = int(m.group(2))
        tail = m.group(3) or ''

        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        blitz = data.get('blitzDeployment') or {}
        current_pn = blitz.get('currentPlayerNum')
        if current_pn is not None and current_pn != player_num:
            return {'ok': False, 'reason': 'not_your_blitz_turn',
                    'currentPlayerNum': current_pn}
        user_id = _uid(interaction)
        owner_id = data.get(f'player{player_num}Id')
        if user_id and str(user_id) != str(owner_id or ''):
            return {'ok': False, 'reason': 'not_owner'}
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'playerNum': player_num, 'tail': tail,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_blitz_group = _make_blitz_handler('blitz_group_')
_handle_blitz_pass = _make_blitz_handler('blitz_pass_')
_handle_blitz_move_fig = _make_blitz_handler('blitz_move_fig_')
_handle_blitz_move_pick = _make_blitz_handler('blitz_move_pick_')
_handle_blitz_move_done = _make_blitz_handler('blitz_move_done_')


register('blitz_group_', _handle_blitz_group, 'core')
register('blitz_pass_', _handle_blitz_pass, 'core')
register('blitz_move_fig_', _handle_blitz_move_fig, 'core')
register('blitz_move_pick_', _handle_blitz_move_pick, 'core')
register('blitz_move_done_', _handle_blitz_move_done, 'core')
