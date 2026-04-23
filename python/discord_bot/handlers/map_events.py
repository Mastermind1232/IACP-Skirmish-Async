"""Map-events Discord handlers — thin port of src/handlers/map-events.js.

Covers the queue-advancing skip handlers for map-specific effects
(Krykna, Fluctuation). Each pops the head of a queue; the downstream
"post next picker" step belongs to the bot UI layer.

  krykna_place_skip_{gameId}      — shift pendingClaimedKryknaQueue
  fluctuation_skip_{gameId}       — shift pendingFluctuationSwapQueue
"""
from __future__ import annotations

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


def _resolve_game(ctx: Dict[str, Any], game_id: str) -> Any:
    get_game = ctx.get('get_game')
    if not callable(get_game):
        return None
    return get_game(game_id)


def _make_queue_shift_skip(prefix: str, queue_key: str
                             ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """Factory for queue-based skip handlers. `{prefix}{gameId}` pops
    the head of `data[queue_key]` after validating the presser owns
    the turn. Drops the outer key when the queue drains.
    """
    assert prefix.endswith('_')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        if not cid.startswith(prefix):
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = cid[len(prefix):]
        if not game_id:
            return {'ok': False, 'reason': 'malformed_custom_id'}

        game = _resolve_game(ctx, game_id)
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        queue = list(data.get(queue_key) or [])
        if not queue:
            return {'ok': False, 'reason': 'queue_empty'}

        expected_pn = queue[0]
        user_id = _uid(interaction)
        owner_id = data.get(f'player{expected_pn}Id')
        if user_id and str(user_id) != str(owner_id or ''):
            return {
                'ok': False, 'reason': 'wrong_player_turn',
                'expectedPlayerNum': expected_pn,
            }

        queue.pop(0)
        if queue:
            data[queue_key] = queue
        else:
            data.pop(queue_key, None)

        save = ctx.get('save_games')
        if callable(save):
            save()
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'queueKey': queue_key, 'queueRemaining': len(queue),
            'playerSkipped': expected_pn,
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_krykna_place_skip = _make_queue_shift_skip(
    'krykna_place_skip_', 'pendingClaimedKryknaQueue',
)
_handle_fluctuation_skip = _make_queue_shift_skip(
    'fluctuation_skip_', 'pendingFluctuationSwapQueue',
)


register('krykna_place_skip_', _handle_krykna_place_skip, 'core')
register('fluctuation_skip_', _handle_fluctuation_skip, 'core')
