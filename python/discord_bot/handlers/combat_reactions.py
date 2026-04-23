"""Combat-reactions Discord handlers — thin port of
src/handlers/combat-reactions.js.

Covers the pure-skip/pure-dismiss paths of combat-reaction CCs
that defenders/attackers can play after dice roll. Each skip clears
a `pending*` key and marks the triggering gate as resolved. The
reroll-window handoff lives in the combat orchestrator port.

  there_is_no_try_skip_{gameId}  — clears pendingThereIsNoTry,
                                    stamps combat.tintResolved=True
  tough_luck_skip_{gameId}       — clears pendingToughLuck
  hunter_protocol_skip_{gameId}  — clears pendingHunterProtocol
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

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


def _make_reaction_skip(prefix: str, pending_key: str,
                         tint_flag: Optional[str] = None
                         ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """Factory for reaction-skip handlers. Optionally stamps a combat
    resolution flag (e.g. `tintResolved`) to advance the combat flow.
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
        data.pop(pending_key, None)

        if tint_flag:
            combat = data.get('pendingCombat')
            if isinstance(combat, dict):
                combat[tint_flag] = True

        save = ctx.get('save_games')
        if callable(save):
            save()
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'pendingCleared': pending_key,
            'combatFlagSet': tint_flag,
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


_handle_there_is_no_try_skip = _make_reaction_skip(
    'there_is_no_try_skip_', 'pendingThereIsNoTry', tint_flag='tintResolved',
)
_handle_tough_luck_skip = _make_reaction_skip(
    'tough_luck_skip_', 'pendingToughLuck',
)
_handle_hunter_protocol_skip = _make_reaction_skip(
    'hunter_protocol_skip_', 'pendingHunterProtocol',
)


register('there_is_no_try_skip_', _handle_there_is_no_try_skip, 'core')
register('tough_luck_skip_', _handle_tough_luck_skip, 'core')
register('hunter_protocol_skip_', _handle_hunter_protocol_skip, 'core')
