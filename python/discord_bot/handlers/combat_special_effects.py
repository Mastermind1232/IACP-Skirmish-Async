"""Combat special-effects Discord handlers — thin port of
src/handlers/combat-special-effects.js.

Covers the lightweight "skip" buttons that only clear a pending
scratch-state key. The heavy effect paths (boltslinger target damage,
sidewinder strain+move) will land when their UI scaffolding does.

Skip-button family (shared `_make_pending_skip_handler` factory):
  sidewinder_skip_{gameId}           — no-op skip
  boltslinger_skip_{gameId}          — clears pendingBoltslinger
  indiscriminate_skip_{gameId}       — clears pendingIndiscriminateFire
  fighting_knife_skip_{gameId}       — clears pendingFightingKnife
  havoc_shot_skip_{gameId}           — clears pendingHavocShot
  deflect_skip_{gameId}              — clears pendingDeflect
  wanton_skip_{gameId}               — clears pendingWanton
  heavy_fire_skip_{gameId}           — clears pendingHeavyFire
  zillo_discard_skip_{gameId}        — clears pendingZilloDiscard
"""
from __future__ import annotations

import re
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


def _make_pending_skip_handler(prefix: str,
                                 pending_key: Optional[str],
                                 allow_trailing: bool = False
                                 ) -> Callable[[Any, Dict[str, Any]], Dict[str, Any]]:
    """Factory for `${prefix}{gameId}[_{trailing}]` → clear
    `game.${pending_key}` skip handlers. `pending_key=None` means
    "no state mutation, just dismiss" (sidewinder-style).

    When `allow_trailing=True`, the customId may have anything after
    the gameId segment (e.g. `mvint_skip_{gameId}_{triggerType}_{fk}`)
    and only the first segment after the prefix is captured as gameId.
    """
    assert prefix.endswith('_')
    if allow_trailing:
        pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)(?:_.*)?$')
    else:
        pattern = re.compile(r'^' + re.escape(prefix) + r'([^_]+)$')

    def _handler(interaction: Any, ctx: Dict[str, Any]) -> Dict[str, Any]:
        cid = _cid(interaction)
        m = pattern.match(cid)
        if not m:
            return {'ok': False, 'reason': 'malformed_custom_id'}
        game_id = m.group(1)
        if pending_key is None:
            return {'ok': True, 'gameId': game_id, 'pendingCleared': None}

        game = _resolve_game(ctx, game_id)
        if game is None:
            return {'ok': False, 'reason': 'game_not_found', 'gameId': game_id}
        data = game.data if hasattr(game, 'data') else game
        data.pop(pending_key, None)

        save = ctx.get('save_games')
        if callable(save):
            save()
        return {
            'ok': True, 'game': game, 'gameId': game_id,
            'pendingCleared': pending_key,
        }

    _handler.__name__ = f'_handle_{prefix.strip("_")}'
    return _handler


# Named handlers exposed for test imports + explicit register() calls.
_handle_sidewinder_skip = _make_pending_skip_handler('sidewinder_skip_', None)
_handle_boltslinger_skip = _make_pending_skip_handler('boltslinger_skip_', 'pendingBoltslinger')
_handle_indiscriminate_skip = _make_pending_skip_handler(
    'indiscriminate_skip_', 'pendingIndiscriminateFire',
)
_handle_fighting_knife_skip = _make_pending_skip_handler(
    'fighting_knife_skip_', 'pendingFightingKnife',
)
_handle_havoc_shot_skip = _make_pending_skip_handler(
    'havoc_shot_skip_', 'pendingHavocShot',
)
_handle_deflect_skip = _make_pending_skip_handler('deflect_skip_', 'pendingDeflect')
_handle_wanton_skip = _make_pending_skip_handler('wanton_skip_', 'pendingWanton')
_handle_heavy_fire_skip = _make_pending_skip_handler(
    'heavy_fire_skip_', 'pendingHeavyFire',
)
_handle_zillo_discard_skip = _make_pending_skip_handler(
    'zillo_discard_skip_', 'pendingZilloDiscard',
)


register('sidewinder_skip_', _handle_sidewinder_skip, 'core')
register('boltslinger_skip_', _handle_boltslinger_skip, 'core')
register('indiscriminate_skip_', _handle_indiscriminate_skip, 'core')
register('fighting_knife_skip_', _handle_fighting_knife_skip, 'core')
register('havoc_shot_skip_', _handle_havoc_shot_skip, 'core')
register('deflect_skip_', _handle_deflect_skip, 'core')
register('wanton_skip_', _handle_wanton_skip, 'core')
register('heavy_fire_skip_', _handle_heavy_fire_skip, 'core')
register('zillo_discard_skip_', _handle_zillo_discard_skip, 'core')
