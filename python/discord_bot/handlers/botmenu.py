"""Botmenu Discord handlers — thin port of src/handlers/botmenu.js.

Covers the "dismiss" buttons from the kill/forfeit confirmation flows.
The heavier delete-channels / defeat-counterpart paths stay deferred.

  botmenu_kill_no_{gameId}   — dismiss the kill-game confirm prompt
  forfeit_no_{gameId}         — dismiss the forfeit confirm prompt
  botmenu_kill_{gameId}       — show the kill confirmation (validates
                                participant / admin); the "yes" branch
                                that actually deletes channels stays
                                deferred
"""
from __future__ import annotations

from typing import Any, Dict

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


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Any:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _handle_botmenu_kill_no(interaction: Any,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """botmenu_kill_no_{gameId} — pure dismiss. Mirrors
    src/handlers/botmenu.js:202-204.
    """
    cid = _cid(interaction)
    if not cid.startswith('botmenu_kill_no_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('botmenu_kill_no_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    return {'ok': True, 'gameId': game_id}


def _handle_forfeit_no(interaction: Any,
                         ctx: Dict[str, Any]) -> Dict[str, Any]:
    """forfeit_no_{gameId} — pure dismiss. Mirrors
    src/handlers/botmenu.js:264-266.
    """
    cid = _cid(interaction)
    if not cid.startswith('forfeit_no_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('forfeit_no_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    return {'ok': True, 'gameId': game_id}


def _handle_botmenu_kill(interaction: Any,
                           ctx: Dict[str, Any]) -> Dict[str, Any]:
    """botmenu_kill_{gameId} — validate the presser is a game
    participant, confirm the intent. Mirrors src/handlers/botmenu.js:150-173
    state-validation half; the UI that renders the yes/no row belongs
    to the bot layer.
    """
    cid = _cid(interaction)
    if not cid.startswith('botmenu_kill_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('botmenu_kill_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}

    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    is_player = user_id and str(user_id) in (
        str(data.get('player1Id') or ''), str(data.get('player2Id') or ''),
    )
    if not is_player:
        # Admin bypass: caller can set ctx.is_admin=True after checking
        # Discord roles on their side. Default-deny when absent.
        if not ctx.get('is_admin'):
            return {'ok': False, 'reason': 'not_authorized'}
    return {'ok': True, 'gameId': game_id, 'isPlayer': bool(is_player)}


register('botmenu_kill_no_', _handle_botmenu_kill_no, 'core')
register('forfeit_no_', _handle_forfeit_no, 'core')
register('botmenu_kill_', _handle_botmenu_kill, 'core')
