"""Combat special-effects Discord handlers — thin port of
src/handlers/combat-special-effects.js.

Covers the lightweight "skip" buttons that only clear a pending
scratch-state key. The heavy effect paths (boltslinger target damage,
sidewinder strain+move) will land when their UI scaffolding does.

  sidewinder_skip_{gameId}           — no-op skip
  boltslinger_skip_{gameId}          — clears pendingBoltslinger
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


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Any:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _handle_sidewinder_skip(interaction: Any,
                              ctx: Dict[str, Any]) -> Dict[str, Any]:
    """sidewinder_skip_{gameId} — pure UI dismiss. JS just edits the
    message without touching state. Mirrors
    src/handlers/combat-special-effects.js:302-307.
    """
    cid = _cid(interaction)
    if not cid.startswith('sidewinder_skip_'):
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = cid[len('sidewinder_skip_'):]
    if not game_id:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    return {'ok': True, 'gameId': game_id}


def _handle_boltslinger_skip(interaction: Any,
                               ctx: Dict[str, Any]) -> Dict[str, Any]:
    """boltslinger_skip_{gameId} — clears game.pendingBoltslinger.
    Mirrors src/handlers/combat-special-effects.js:363-372.
    """
    cid = _cid(interaction)
    m = re.match(r'^boltslinger_skip_([^_]+)$', cid)
    if not m:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id = m.group(1)

    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game
    if 'pendingBoltslinger' in data:
        data.pop('pendingBoltslinger', None)
    else:
        data['pendingBoltslinger'] = None

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {'ok': True, 'game': game, 'gameId': game_id}


register('sidewinder_skip_', _handle_sidewinder_skip, 'core')
register('boltslinger_skip_', _handle_boltslinger_skip, 'core')
