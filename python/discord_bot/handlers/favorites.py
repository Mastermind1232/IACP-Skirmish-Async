"""Favorites Discord handlers — thin port of src/handlers/favorites.js.

Favorites are user-owned squad/deck presets stored in an external file
(handled outside the game state). The Python port validates the customId
shape + ownership and returns the intent for the bot layer to persist.

  fav_save_{gameId}_{playerNum}
  fav_remove_{gameId}_{playerNum}
  fav_rename_{gameId}_{playerNum}
  fav_choose_{gameId}_{playerNum}
  fav_choose_select_{gameId}_{playerNum}
  fav_list_select_{threadId}
  fav_list_rename_{threadId}
  fav_list_remove_{threadId}
  fav_list_back_{threadId}
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


def _make_fav_game_handler(prefix: str
                             ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """fav_*_{gameId}_{playerNum} handlers — validate owner + parse."""
    assert prefix.endswith('_')
    pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)_([12])$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id, player_num_str = m.group(1), m.group(2)
        player_num = int(player_num_str)

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
            'ok': True, 'gameId': game_id, 'playerNum': player_num,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


def _make_fav_list_handler(prefix: str
                              ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """fav_list_*_{threadId} handlers — just parse threadId."""
    assert prefix.endswith('_')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        if not cid.startswith(prefix):
            return {'ok': False, 'reason': 'malformed_custom_id'}
        thread_id = cid[len(prefix):]
        if not thread_id:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        return {
            'ok': True, 'threadId': thread_id,
            'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_fav_save = _make_fav_game_handler('fav_save_')
_handle_fav_remove = _make_fav_game_handler('fav_remove_')
_handle_fav_rename = _make_fav_game_handler('fav_rename_')
_handle_fav_choose = _make_fav_game_handler('fav_choose_')
_handle_fav_choose_select = _make_fav_game_handler('fav_choose_select_')
_handle_fav_list_select = _make_fav_list_handler('fav_list_select_')
_handle_fav_list_rename = _make_fav_list_handler('fav_list_rename_')
_handle_fav_list_remove = _make_fav_list_handler('fav_list_remove_')
_handle_fav_list_back = _make_fav_list_handler('fav_list_back_')


register('fav_save_', _handle_fav_save, 'core')
register('fav_remove_', _handle_fav_remove, 'core')
register('fav_rename_', _handle_fav_rename, 'core')
register('fav_choose_', _handle_fav_choose, 'core')
register('fav_choose_select_', _handle_fav_choose_select, 'core')
register('fav_list_select_', _handle_fav_list_select, 'core')
register('fav_list_rename_', _handle_fav_list_rename, 'core')
register('fav_list_remove_', _handle_fav_list_remove, 'core')
register('fav_list_back_', _handle_fav_list_back, 'core')
