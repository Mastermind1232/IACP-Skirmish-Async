"""D3.8 — Pattern E dispatch (per-ability chain-handler registry).

Pattern E abilities are interactive multi-phase pending-state chains. Unlike
Pattern D's trigger-bus (one registry keyed by trigger name), Pattern E uses
per-ability-id direct dispatch — there is no shared trigger surface.

Each chain lands as its own slice (E.1 Force Push is D3.8, E.2 Fluctuation
is a future slice, and so on through E.20). Until a chain's handler is
registered, `resolve_pattern_e` raises `ChainNotImplemented` on fire — the
fail-loud parity gate that keeps the Python engine honest about coverage.

`install_default_chain_handlers()` wires the chains that have landed as of
the current slice. Idempotent. Called by
`dispatch.install_default_handlers()` on module import.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

from python.engine.abilities.classify import classify_ability
from python.engine.data.ability_library_loader import get_ability


ChainHandler = Callable[[Dict[str, Any], str, Dict[str, Any]], Dict[str, Any]]


class ChainNotImplemented(NotImplementedError):
    """Raised when `resolve_pattern_e` is called on a Pattern E ability that
    has no chain handler registered.

    Fail-loud gate: Pattern E is 355 abilities; each lands one chain at a time.
    A silent no-op would let the AI train on a different game than JS plays.
    """

    def __init__(self, ability_id: str):
        super().__init__(f'Pattern E chain not implemented: {ability_id!r}')
        self.ability_id = ability_id


_chain_registry: Dict[str, ChainHandler] = {}


def register_chain(ability_id: str, handler: ChainHandler) -> None:
    """Install a handler for a Pattern E ability. Overwrites prior registration.

    Used by `install_default_chain_handlers` and by tests that swap in stubs.
    """
    _chain_registry[ability_id] = handler


def unregister_chain(ability_id: str) -> None:
    """Remove a registered chain handler. No-op if not registered."""
    _chain_registry.pop(ability_id, None)


def get_chain_handler(ability_id: str) -> Optional[ChainHandler]:
    """Return the registered handler for `ability_id`, or None."""
    return _chain_registry.get(ability_id)


def registered_chain_ids() -> List[str]:
    """Sorted list of ability IDs with registered chain handlers."""
    return sorted(_chain_registry.keys())


def clear_registry() -> None:
    """Drop every registered chain handler. For test determinism only."""
    _chain_registry.clear()


def resolve_pattern_e(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Dict[str, Any]) -> Dict[str, Any]:
    """Dispatch entry point. Routes Pattern E abilities to their chain handler.

    Raises:
      - `dispatch.UnknownAbility` if ability_id is missing from the library.
      - `ValueError` if ability_id does not classify as Pattern E.
      - `ChainNotImplemented` if no handler registered for the ability.

    Otherwise returns `{ability_id, pattern:'E', **handler_payload}`.
    """
    entry = get_ability(ability_id)
    if entry is None:
        # Lazy import to avoid cycles (dispatch imports pattern_e).
        from python.engine.abilities.dispatch import UnknownAbility
        raise UnknownAbility(ability_id)
    pattern, _ = classify_ability(ability_id, entry)
    if pattern != 'E':
        raise ValueError(
            f'resolve_pattern_e: {ability_id!r} is Pattern {pattern}, not E'
        )
    handler = _chain_registry.get(ability_id)
    if handler is None:
        raise ChainNotImplemented(ability_id)
    payload = handler(game, ability_id, ctx or {})
    return {'ability_id': ability_id, 'pattern': 'E', **(payload or {})}


def install_default_chain_handlers() -> None:
    """Wire the built-in Pattern E chains. Idempotent.

    Roster (expands one chain per slice):
      - D3.8:  Force Push
      - D3.11: force_throw            — now served by generalized
                                        handle_push_target_within_range
      - D3.13: hop_on_kuiil
      - D3.15: wrist_cord, mandalorian_whip — share the D3.15 generalized
                                               handler with force_throw
      - D3.17: barrage_ct1701         — 4-phase state-flag mutator (two
                                        attacks, shared msgId state, defender
                                        +1 white die on second attack)
    """
    from python.engine.abilities.barrage import handle_barrage
    from python.engine.abilities.force_push import handle_force_push
    from python.engine.abilities.hop_on import handle_hop_on
    from python.engine.abilities.push_target_within_range import (
        handle_push_target_within_range,
    )
    register_chain('Force Push', handle_force_push)
    register_chain('force_throw', handle_push_target_within_range)
    register_chain('hop_on_kuiil', handle_hop_on)
    register_chain('wrist_cord', handle_push_target_within_range)
    register_chain('mandalorian_whip', handle_push_target_within_range)
    register_chain('barrage_ct1701', handle_barrage)
