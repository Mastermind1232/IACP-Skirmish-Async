"""Handler registry — mirrors src/handlers/index.js.

Each handler owns a button customId prefix (e.g. 'end_turn_', 'move_mp_'),
registered via `register(prefix, handler, group)`. The router dispatches by
longest-prefix match against the incoming customId.

Groups (activation, combat, movement, ccHand, dcPlayArea, etc.) control
which context fields the handler receives — see context.py.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Tuple


# Handler signature: (interaction, ctx) -> None (async in real discord.py;
# the Python port accepts a plain object + ctx dict for test ergonomics).
Handler = Callable[[Any, Dict[str, Any]], Any]

_REGISTRY: List[Tuple[str, Handler, str]] = []
_PREFIX_SET = set()


def register(prefix: str, handler: Handler, group: str) -> None:
    """Register a handler under a customId prefix + context group."""
    if not prefix or not isinstance(prefix, str):
        raise ValueError('register: prefix must be a non-empty string')
    if prefix in _PREFIX_SET:
        raise ValueError(f'register: duplicate prefix {prefix!r}')
    _PREFIX_SET.add(prefix)
    _REGISTRY.append((prefix, handler, group))


def get_registry() -> List[Tuple[str, Handler, str]]:
    """Return a copy of the registry (prefix, handler, group) triples."""
    return list(_REGISTRY)


def get_registered_prefixes() -> List[str]:
    """Return prefixes sorted by length descending (longest-first match)."""
    return sorted((p for p, _, _ in _REGISTRY), key=len, reverse=True)


def find_handler(custom_id: str):
    """Return (prefix, handler, group) for the longest prefix matching custom_id.

    Returns None if no prefix matches.
    """
    for prefix in get_registered_prefixes():
        if custom_id.startswith(prefix):
            for p, h, g in _REGISTRY:
                if p == prefix:
                    return (prefix, h, g)
    return None


def reset_for_tests() -> None:
    """Wipe the registry. Tests should call this in setup/teardown."""
    _REGISTRY.clear()
    _PREFIX_SET.clear()
