"""Button router — mirror of src/router.js.

Dispatches incoming button interactions (or any customId-keyed event) to
the handler registered under the longest-matching prefix.

JS flow:  interaction → buildContext(group, deps) → handler(interaction, ctx)
Python:   interaction → build_context(group, deps) → handler(interaction, ctx)

The prefix set is auto-derived from the registry, sorted longest-first so
'phase_gate_ready_' wins over 'phase_gate_' when both are registered.
"""
from __future__ import annotations

import inspect
from typing import Any, Awaitable, Callable, Dict, Optional, Union

from python.discord_bot.context import build_context
from python.discord_bot.handlers import find_handler


RouteResult = Dict[str, Any]


def _extract_custom_id(interaction: Any) -> Optional[str]:
    """Get the customId string from a discord.py Interaction or a dict stub.

    Supports:
        - interaction.data['custom_id']       (discord.py 2.x raw shape)
        - interaction.customId               (JS-style shim in tests)
        - interaction.custom_id              (Python convention fallback)
    """
    data = getattr(interaction, 'data', None)
    if isinstance(data, dict) and 'custom_id' in data:
        return data['custom_id']
    if hasattr(interaction, 'customId'):
        return interaction.customId
    if hasattr(interaction, 'custom_id'):
        return interaction.custom_id
    return None


def _auto_refresh(result: Any, deps: Dict[str, Any]) -> None:
    """If the handler returned a dict with a gameId, refresh the Discord
    views for that game. Silent no-op when game_channels isn't set up.

    Runs after every successful handler dispatch so the 55 per-family
    handlers don't each need to call refresh themselves.
    """
    if not isinstance(result, dict):
        return
    game_id = result.get('gameId') or result.get('game_id')
    if not game_id:
        return
    game = result.get('game')
    if game is None:
        # Look up from the store if not attached to the result.
        get_game = deps.get('get_game')
        if callable(get_game):
            try:
                game = get_game(game_id)
            except Exception:
                return
    if game is None:
        return
    try:
        from python.discord_bot import game_channels as gc
        backend = deps.get('channel_backend')
        gc.refresh_game_view(game_id, game, backend=backend)
        gc.refresh_hand_view(game_id, 1, game, backend=backend)
        gc.refresh_hand_view(game_id, 2, game, backend=backend)
    except Exception:
        pass


async def route(interaction: Any, deps: Dict[str, Any]) -> RouteResult:
    """Route a button interaction to its registered handler.

    Returns a result dict:
        {'ok': True, 'prefix': str, 'group': str}
      | {'ok': False, 'reason': 'no_custom_id' | 'no_handler'}
      | {'ok': False, 'reason': 'handler_error', 'error': str}
    """
    custom_id = _extract_custom_id(interaction)
    if not custom_id:
        return {'ok': False, 'reason': 'no_custom_id'}

    match = find_handler(custom_id)
    if match is None:
        return {'ok': False, 'reason': 'no_handler', 'customId': custom_id}

    prefix, handler, group = match
    ctx = build_context(group, deps)

    try:
        result = handler(interaction, ctx)
        if inspect.isawaitable(result):
            result = await result
    except Exception as e:
        return {
            'ok': False, 'reason': 'handler_error',
            'error': f'{type(e).__name__}: {e}',
            'customId': custom_id,
            'prefix': prefix,
        }
    # Auto-refresh Discord views after successful dispatches.
    if isinstance(result, dict) and result.get('ok'):
        _auto_refresh(result, deps)
    return {'ok': True, 'prefix': prefix, 'group': group}


def route_sync(interaction: Any, deps: Dict[str, Any]) -> RouteResult:
    """Synchronous variant of route() for handlers that don't need await.

    When a handler is actually async, this raises RuntimeError. Use route()
    in production; route_sync() is a test ergonomics helper.
    """
    custom_id = _extract_custom_id(interaction)
    if not custom_id:
        return {'ok': False, 'reason': 'no_custom_id'}

    match = find_handler(custom_id)
    if match is None:
        return {'ok': False, 'reason': 'no_handler', 'customId': custom_id}

    prefix, handler, group = match
    ctx = build_context(group, deps)

    try:
        result = handler(interaction, ctx)
        if inspect.isawaitable(result):
            raise RuntimeError(
                f'route_sync: handler for {prefix!r} returned an awaitable; use route()'
            )
    except RuntimeError:
        raise
    except Exception as e:
        return {
            'ok': False, 'reason': 'handler_error',
            'error': f'{type(e).__name__}: {e}',
            'customId': custom_id,
            'prefix': prefix,
        }
    if isinstance(result, dict) and result.get('ok'):
        _auto_refresh(result, deps)
    return {'ok': True, 'prefix': prefix, 'group': group}
