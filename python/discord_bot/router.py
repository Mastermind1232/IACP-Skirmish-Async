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
            await result
    except Exception as e:
        return {
            'ok': False, 'reason': 'handler_error',
            'error': f'{type(e).__name__}: {e}',
            'customId': custom_id,
            'prefix': prefix,
        }
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
    return {'ok': True, 'prefix': prefix, 'group': group}
