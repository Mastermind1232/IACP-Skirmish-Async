"""Space-picker UI Discord handlers — thin port of
src/handlers/space-picker.js.

Both are pure UI navigation — the bot layer manages
game.pendingSpacePick entries and edits the message to show the
row-or-cell picker. The Python port just validates and parses.

  space_row_{contextKey}_{rowNum}   — user picked a row, show cells
  space_row_back_{contextKey}       — return to row picker
"""
from __future__ import annotations

import re
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


def _handle_space_row(interaction: Any,
                        ctx: Dict[str, Any]) -> Dict[str, Any]:
    """space_row_{contextKey}_{rowNum} — user picked a row. contextKey
    starts with gameId (first underscore segment). Mirrors
    src/handlers/space-picker.js:33-92.
    """
    cid = _cid(interaction)
    m = re.match(r'^space_row_(.+)_(\d+)$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    context_key, row_num_str = m.group(1), m.group(2)
    game_id = context_key.split('_', 1)[0]

    get_game = ctx.get('get_game')
    game = get_game(game_id) if callable(get_game) else None
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    pending = (data.get('pendingSpacePick') or {}).get(context_key)
    if not pending:
        return {'ok': False, 'reason': 'space_selection_expired'}
    return {
        'ok': True, 'gameId': game_id, 'contextKey': context_key,
        'rowNum': int(row_num_str),
    }


def _handle_space_row_back(interaction: Any,
                             ctx: Dict[str, Any]) -> Dict[str, Any]:
    """space_row_back_{contextKey} — return to row picker. Mirrors
    src/handlers/space-picker.js:97-143.
    """
    cid = _cid(interaction)
    m = re.match(r'^space_row_back_(.+)$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    context_key = m.group(1)
    game_id = context_key.split('_', 1)[0]

    get_game = ctx.get('get_game')
    game = get_game(game_id) if callable(get_game) else None
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    pending = (data.get('pendingSpacePick') or {}).get(context_key)
    if not pending:
        return {'ok': False, 'reason': 'space_selection_expired'}
    return {
        'ok': True, 'gameId': game_id, 'contextKey': context_key,
    }


register('space_row_back_', _handle_space_row_back, 'core')
register('space_row_', _handle_space_row, 'core')
