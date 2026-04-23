"""Game-tools Discord handlers — thin port of src/handlers/game-tools.js.

Covers the UI-level buttons for map refresh / admin actions that only
need ownership validation. The heavy flows (undo snapshot restore, kill
game channel deletion) stay deferred.

  refresh_map_{gameId}  — validate participant, trigger board re-render
  refresh_all_{gameId}  — validate participant, trigger full refresh
  undo_{gameId}          — validate participant, pop undo stack (state
                            mutation half only; thread cleanup deferred)
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


def _participant_only(interaction: Any, game: Any, prefix: str,
                       cid: str) -> Dict[str, Any]:
    """Shared validator: verify the presser is a game participant."""
    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    if user_id and str(user_id) not in (
        str(data.get('player1Id') or ''),
        str(data.get('player2Id') or ''),
    ):
        return {'ok': False, 'reason': 'not_a_player_in_game'}
    return {}


def _handle_refresh_map(interaction: Any,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """refresh_map_{gameId} — validate participant. UI-only handler;
    the actual embed re-render happens in the bot layer. Mirrors
    src/handlers/game-tools.js:88-110 state-validation half.
    """
    cid = _cid(interaction)
    if not cid.startswith('refresh_map_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('refresh_map_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    err = _participant_only(interaction, game, 'refresh_map_', cid)
    if err:
        return err
    data = game.data if hasattr(game, 'data') else game
    if not data.get('selectedMap'):
        return {'ok': False, 'reason': 'no_map_selected'}
    return {'ok': True, 'game': game, 'gameId': game_id}


def _handle_refresh_all(interaction: Any,
                          ctx: Dict[str, Any]) -> Dict[str, Any]:
    """refresh_all_{gameId} — admin-style full refresh. Validate
    participant. UI-only state mutation — the bot layer re-renders
    every message.
    """
    cid = _cid(interaction)
    if not cid.startswith('refresh_all_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('refresh_all_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    err = _participant_only(interaction, game, 'refresh_all_', cid)
    if err:
        return err
    return {'ok': True, 'game': game, 'gameId': game_id}


def _handle_undo(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """undo_{gameId} — pop the top of the undo stack if present.
    Mirrors src/handlers/game-tools.js:142+ state-mutation half only
    (thread / embed cleanup lives in the bot UI layer).
    """
    cid = _cid(interaction)
    if not cid.startswith('undo_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('undo_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    err = _participant_only(interaction, game, 'undo_', cid)
    if err:
        return err

    data = game.data if hasattr(game, 'data') else game
    stack = list(data.get('undoStack') or [])
    if not stack:
        return {'ok': False, 'reason': 'no_undo_available'}
    snapshot = stack.pop()
    data['undoStack'] = stack

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'snapshotPopped': True,
        'stackRemaining': len(stack),
    }


register('refresh_map_', _handle_refresh_map, 'core')
register('refresh_all_', _handle_refresh_all, 'core')
register('undo_', _handle_undo, 'core')
