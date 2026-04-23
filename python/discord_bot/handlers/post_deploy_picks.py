"""Thin validators for post-deploy picker buttons.

Each handler validates participant / ownership and returns the parsed
tail for the bot layer. Real state mutation (strike team token
placement, arms distribution, companion deploy movement) lives in the
post-deploy orchestrator port that follows.

  pd_pick_{gameId}_{playerNum}_{abilityId}
  pd_security_pick_{gameId}_{playerNum}_{figureKey}
  pd_strike_adj_{gameId}_{playerNum}_{space}
  pd_strike_order_{gameId}_{playerNum}_{figureKey}
  pd_strike_token_{gameId}_{playerNum}_{space}
  pd_move_skip_{gameId}_{playerNum}_{moveKey}
  pd_move_stay_{gameId}_{playerNum}_{figureKey}
  pd_sl_pick_{gameId}_{playerNum}_{space}
  pd_walker_move_{gameId}
  pd_arms_dist_fig_{gameId}_{playerNum}_{figureKey}
  pd_arms_dist_token_{gameId}_{playerNum}_{tokenColor}
  pd_comp_space_{gameId}_{playerNum}_{space}
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


def _make_pd_pick_handler(prefix: str
                            ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}_{playerNum}_{tail} — validate owner + return tail."""
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


def _make_pd_game_handler(prefix: str
                             ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId} — validate participant via postDeployQueue."""
    assert prefix.endswith('_')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        if not cid.startswith(prefix):
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = cid[len(prefix):]
        if not game_id:
            return {'ok': False, 'reason': 'malformed_custom_id'}

        get_game = ctx.get('get_game')
        game = get_game(game_id) if callable(get_game) else None
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

        data = game.data if hasattr(game, 'data') else game
        queue = data.get('postDeployQueue') or {}
        pn = queue.get('currentPlayerNum')
        user_id = _uid(interaction)
        owner_id = data.get(f'player{pn}Id') if pn else None
        if user_id and owner_id and str(user_id) != str(owner_id):
            return {'ok': False, 'reason': 'not_owner'}
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'currentPlayerNum': pn,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_pd_pick = _make_pd_pick_handler('pd_pick_')
_handle_pd_security_pick = _make_pd_pick_handler('pd_security_pick_')
_handle_pd_strike_adj = _make_pd_pick_handler('pd_strike_adj_')
_handle_pd_strike_order = _make_pd_pick_handler('pd_strike_order_')
_handle_pd_strike_token = _make_pd_pick_handler('pd_strike_token_')
_handle_pd_move_skip = _make_pd_pick_handler('pd_move_skip_')
_handle_pd_move_stay = _make_pd_pick_handler('pd_move_stay_')
_handle_pd_sl_pick = _make_pd_pick_handler('pd_sl_pick_')
_handle_pd_arms_dist_fig = _make_pd_pick_handler('pd_arms_dist_fig_')
_handle_pd_arms_dist_token = _make_pd_pick_handler('pd_arms_dist_token_')
_handle_pd_comp_space = _make_pd_pick_handler('pd_comp_space_')
_handle_pd_walker_move = _make_pd_game_handler('pd_walker_move_')


register('pd_pick_', _handle_pd_pick, 'core')
register('pd_security_pick_', _handle_pd_security_pick, 'core')
register('pd_strike_adj_', _handle_pd_strike_adj, 'core')
register('pd_strike_order_', _handle_pd_strike_order, 'core')
register('pd_strike_token_', _handle_pd_strike_token, 'core')
register('pd_move_skip_', _handle_pd_move_skip, 'core')
register('pd_move_stay_', _handle_pd_move_stay, 'core')
register('pd_sl_pick_', _handle_pd_sl_pick, 'core')
register('pd_arms_dist_fig_', _handle_pd_arms_dist_fig, 'core')
register('pd_arms_dist_token_', _handle_pd_arms_dist_token, 'core')
register('pd_comp_space_', _handle_pd_comp_space, 'core')
register('pd_walker_move_', _handle_pd_walker_move, 'core')
