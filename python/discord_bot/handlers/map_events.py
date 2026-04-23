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


# ---------------------------------------------------------------------------
# Concrete push handlers — perform the actual coordinate change.
# ---------------------------------------------------------------------------
def _split_game_coord(cid: str, prefix: str):
    """Parse customId = {prefix}{gameId}_{origCoord} (devaron) or
    {prefix}{gameId}_krykna-{N} (krykna). Returns (game_id, tail) or None.
    """
    if not cid.startswith(prefix):
        return None
    rest = cid[len(prefix):]
    # Devaron: last underscore separates gameId and origCoord.
    # Krykna: "krykna-" is a substring we can anchor on.
    if 'krykna-' in rest:
        idx = rest.index('krykna-')
        # game_id_krykna-N → game_id is everything before "_krykna-"
        if idx >= 1 and rest[idx - 1] == '_':
            return rest[:idx - 1], rest[idx:]
        return None
    lu = rest.rfind('_')
    if lu < 0:
        return None
    return rest[:lu], rest[lu + 1:]


def _handle_devaron_crate_push(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Push a crate up to 3 spaces. Consumes `target_coord` from
    interaction.data['target_coord'] (modal field) or ctx['target_coord'].
    """
    from python.engine.mechanics.board_helpers import count_game_spaces
    cid = _cid(interaction)
    parsed = _split_game_coord(cid, 'devaron_crate_push_')
    if parsed is None:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, orig_coord = parsed
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    # Target coord comes from modal fields or ctx override for headless/AI.
    target = None
    inter_data = getattr(interaction, 'data', None)
    if isinstance(inter_data, dict):
        target = inter_data.get('target_coord')
    if not target:
        target = ctx.get('target_coord')
    if not isinstance(target, str) or not target.strip():
        return {'ok': False, 'reason': 'missing_target_coord'}
    target = target.strip().lower()

    crate_positions = data.get('cratePositions') or {}
    cur_coord = str(crate_positions.get(orig_coord, orig_coord)).lower()
    if cur_coord == target:
        return {'ok': True, 'game': game, 'noChange': True}

    dist = count_game_spaces(game, cur_coord, target)
    if dist == float('inf'):
        return {'ok': False, 'reason': 'unreachable', 'from': cur_coord, 'to': target}
    if dist > 3:
        return {'ok': False, 'reason': 'out_of_range', 'distance': int(dist), 'maxDistance': 3}

    crate_positions[orig_coord] = target
    data['cratePositions'] = crate_positions

    # Pop the push prompt off pendingCratePushPrompts if present.
    pending = data.get('pendingCratePushPrompts') or {}
    for pn in (1, 2):
        items = list(pending.get(pn) or [])
        items = [x for x in items if (x or {}).get('origCoord') != orig_coord]
        if items:
            pending[pn] = items
        else:
            pending.pop(pn, None)
    if pending:
        data['pendingCratePushPrompts'] = pending
    else:
        data.pop('pendingCratePushPrompts', None)

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'origCoord': orig_coord, 'fromCoord': cur_coord,
        'toCoord': target, 'distance': int(dist),
    }


def _handle_krykna_push(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Push a Krykna NPC up to 3 spaces. Consumes `target_coord` from
    interaction/modal data or ctx."""
    from python.engine.mechanics.board_helpers import count_game_spaces
    cid = _cid(interaction)
    parsed = _split_game_coord(cid, 'krykna_push_')
    if parsed is None:
        return {'ok': False, 'reason': 'malformed_custom_id'}
    game_id, krykna_id = parsed
    game = _resolve_game(ctx, game_id)
    if game is None:
        return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
    data = game.data if hasattr(game, 'data') else game

    queue = list(data.get('pendingKryknaPushQueue') or [])
    if not queue:
        return {'ok': False, 'reason': 'no_pending_push'}

    npcs = list(data.get('npcKrykna') or [])
    krykna = next((k for k in npcs if isinstance(k, dict) and k.get('id') == krykna_id), None)
    if krykna is None or krykna.get('defeated'):
        return {'ok': False, 'reason': 'krykna_not_found'}

    target = None
    inter_data = getattr(interaction, 'data', None)
    if isinstance(inter_data, dict):
        target = inter_data.get('target_coord')
    if not target:
        target = ctx.get('target_coord')
    if not isinstance(target, str) or not target.strip():
        return {'ok': False, 'reason': 'missing_target_coord'}
    target = target.strip().lower()

    cur_coord = str(krykna.get('coord') or '').lower()
    if cur_coord == target:
        return {'ok': True, 'game': game, 'noChange': True}
    dist = count_game_spaces(game, cur_coord, target)
    if dist == float('inf'):
        return {'ok': False, 'reason': 'unreachable'}
    if dist > 3:
        return {'ok': False, 'reason': 'out_of_range', 'distance': int(dist)}

    old_coord = krykna['coord']
    krykna['coord'] = target
    data['npcKrykna'] = npcs
    pushed_ids = list(data.get('kryknaPushedIds') or [])
    pushed_ids.append(krykna_id)
    data['kryknaPushedIds'] = pushed_ids
    queue.pop(0)
    if queue:
        data['pendingKryknaPushQueue'] = queue
    else:
        data.pop('pendingKryknaPushQueue', None)

    save = ctx.get('save_games')
    if callable(save):
        save()
    return {
        'ok': True, 'game': game, 'gameId': game_id,
        'kryknaId': krykna_id, 'fromCoord': old_coord,
        'toCoord': target, 'distance': int(dist),
        'queueRemaining': len(queue),
    }


register('devaron_crate_push_', _handle_devaron_crate_push, 'core')
register('krykna_push_', _handle_krykna_push, 'core')
register('krykna_place_skip_', _handle_krykna_place_skip, 'core')
register('fluctuation_skip_', _handle_fluctuation_skip, 'core')
