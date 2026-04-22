"""D3.2 — ability dispatch registry.

Every ability ID in `data/ability-library.json` must resolve to exactly one
registered handler keyed by resolution pattern. Unknown IDs MUST raise
`UnknownAbility` — silent "no-op" fall-through is a ship-blocker for parity.

Pattern handlers are registered lazily on first use:
  - Pattern A (stat-delta) → `pattern_a.resolve`
  - Pattern B/C/D/E → `PatternNotImplemented` raised at `resolve()` call time
    so D3.3's scaffold cleanly exposes which patterns haven't landed yet.

`resolve(game, ability_id, ctx) -> dict` is the single call site. Callers
pass a mutable game dict (mirrors JS `game` object shape) and a ctx dict with
the resolution-site metadata (figure_key, msg_id, player_num, figure_index,
...). Returns a dict describing what was applied — scaffolding will expand
this as more patterns land.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from python.engine.abilities.classify import (
    build_inventory,
    classify_ability,
    load_inventory,
)
from python.engine.data.ability_library_loader import get_ability, get_ability_library


# ── Error types ─────────────────────────────────────────────────────────────

class UnknownAbility(KeyError):
    """Raised when `resolve()` is called with an ability_id not in the library.

    Prefer this over KeyError so callers can catch it explicitly without
    accidentally swallowing other KeyErrors from inside the handler.
    """


class PatternNotImplemented(NotImplementedError):
    """Raised when an ability's pattern has no handler wired yet (B/C/D/E
    during the D3 scaffold slice). Callers should distinguish this from
    `UnknownAbility` so the parity harness can classify a failure.
    """


class UnsupportedPatternAField(RuntimeError):
    """Raised by the Pattern A handler when a field in a classified-A entry
    lacks a wired handler. Fail loudly, never silently skip.
    """


# ── Registry ────────────────────────────────────────────────────────────────

PatternHandler = Callable[[Dict[str, Any], str, Dict[str, Any]], Dict[str, Any]]

_registry: Dict[str, PatternHandler] = {}


def register(pattern: str, handler: PatternHandler) -> None:
    """Install a handler for a pattern. Overwrites prior registration — used
    mostly by tests that swap in stubs."""
    if pattern not in ('A', 'B', 'C', 'D', 'E'):
        raise ValueError(f'register: invalid pattern {pattern!r}')
    _registry[pattern] = handler


def unregister(pattern: str) -> None:
    _registry.pop(pattern, None)


def get_handler(pattern: str) -> Optional[PatternHandler]:
    return _registry.get(pattern)


# ── Resolution entry point ──────────────────────────────────────────────────

def resolve(game: Dict[str, Any],
            ability_id: str,
            ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Dispatch an ability by ID to its pattern handler.

    - Raises `UnknownAbility` if ability_id is not in the library.
    - Raises `PatternNotImplemented` if the pattern has no handler registered
      (expected for B/C/D/E during the D3 scaffold slice).
    - Otherwise returns the handler's result dict.
    """
    entry = get_ability(ability_id)
    if entry is None:
        raise UnknownAbility(ability_id)

    pattern, reason = classify_ability(ability_id, entry)
    handler = _registry.get(pattern)
    if handler is None:
        raise PatternNotImplemented(
            f'ability {ability_id!r} classified as Pattern {pattern} ({reason}) '
            f'but no Pattern {pattern} handler registered yet (D3 scaffold slice)'
        )

    if ctx is None:
        ctx = {}
    return handler(game, ability_id, ctx)


def lookup_pattern(ability_id: str) -> str:
    """Return the pattern letter for an ability_id without resolving it.

    Raises UnknownAbility if the ID is unknown. Used by callers that need to
    route (e.g., 'is this a passive? a trigger?') without executing the
    handler.
    """
    entry = get_ability(ability_id)
    if entry is None:
        raise UnknownAbility(ability_id)
    pattern, _ = classify_ability(ability_id, entry)
    return pattern


# ── Default handler registration (lazy import to avoid cycles) ──────────────

def install_default_handlers() -> None:
    """Wire the built-in pattern handlers. Idempotent."""
    from python.engine.abilities.pattern_a import resolve_pattern_a
    from python.engine.abilities.pattern_b import resolve_pattern_b
    from python.engine.abilities.pattern_c import resolve_pattern_c
    from python.engine.abilities.pattern_d import (
        install_pattern_d_stubs,
        resolve_pattern_d,
    )
    from python.engine.abilities.pattern_d_handlers import (
        install_combat_declare_handlers,
        install_combat_defense_friends_handlers,
    )
    from python.engine.abilities.pattern_e import (
        install_default_chain_handlers,
        resolve_pattern_e,
    )
    register('A', resolve_pattern_a)
    register('B', resolve_pattern_b)
    register('C', resolve_pattern_c)
    register('D', resolve_pattern_d)
    register('E', resolve_pattern_e)
    install_pattern_d_stubs()
    install_combat_declare_handlers()
    install_combat_defense_friends_handlers()
    install_default_chain_handlers()


install_default_handlers()


# ── Diagnostics ─────────────────────────────────────────────────────────────

def dispatch_summary() -> Dict[str, Any]:
    """Return a snapshot of registry state + inventory counts.

    Useful for the parity report: 'Pattern A has a handler, patterns B/C/D/E
    raise PatternNotImplemented at D3-scaffold time'.
    """
    inv = load_inventory()
    return {
        'registry': {p: (_registry[p].__qualname__ if p in _registry else None)
                     for p in ('A', 'B', 'C', 'D', 'E')},
        'counts': inv.get('counts', {}),
        'total': inv.get('total', len(get_ability_library())),
    }
