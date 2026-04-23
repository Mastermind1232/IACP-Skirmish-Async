"""Fast-forward + defender-CC Discord handlers (thin ports).

  fast_forward_{gameId}     — advance the AI-controlled side
  dc_cc_defender_{...}      — defender plays a CC in response to attack
  deck_illegal_play_{...}   — admin override to allow a flagged CC
  deck_illegal_redo_{...}   — admin override to re-trigger illegal check
  illegal_cc_ignore_{...}   — player confirms an illegal CC play
  illegal_cc_unplay_{...}   — player retracts an illegal CC play
  ike_keep_{gameId}         — "It's Keepable Enough" confirmation
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


def _require_participant(interaction: Any, game: Any) -> bool:
    data = game.data if hasattr(game, 'data') else game
    user_id = _uid(interaction)
    return not user_id or str(user_id) in (
        str(data.get('player1Id') or ''),
        str(data.get('player2Id') or ''),
    )


def _make_game_id_handler(prefix: str
                             ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId} — validate participant, return parsed info."""
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
        if not _require_participant(interaction, game):
            return {'ok': False, 'reason': 'not_a_player_in_game'}
        return {'ok': True, 'game': game, 'gameId': game_id,
                'action': prefix.rstrip('_')}

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


def _make_game_id_trailing_handler(prefix: str
                                      ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """{prefix}{gameId}_{trailing...} — validate participant, capture tail."""
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
        if not _require_participant(interaction, game):
            return {'ok': False, 'reason': 'not_a_player_in_game'}
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'tail': tail, 'action': prefix.rstrip('_'),
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_fast_forward = _make_game_id_handler('fast_forward_')
_handle_ike_keep = _make_game_id_handler('ike_keep_')
_handle_dc_cc_defender = _make_game_id_trailing_handler('dc_cc_defender_')
_handle_deck_illegal_play = _make_game_id_trailing_handler('deck_illegal_play_')
_handle_deck_illegal_redo = _make_game_id_trailing_handler('deck_illegal_redo_')
_handle_illegal_cc_ignore = _make_game_id_trailing_handler('illegal_cc_ignore_')
_handle_illegal_cc_unplay = _make_game_id_trailing_handler('illegal_cc_unplay_')


register('fast_forward_', _handle_fast_forward, 'core')
register('ike_keep_', _handle_ike_keep, 'core')
register('dc_cc_defender_', _handle_dc_cc_defender, 'core')
register('deck_illegal_play_', _handle_deck_illegal_play, 'core')
register('deck_illegal_redo_', _handle_deck_illegal_redo, 'core')
register('illegal_cc_ignore_', _handle_illegal_cc_ignore, 'core')
register('illegal_cc_unplay_', _handle_illegal_cc_unplay, 'core')
