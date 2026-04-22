"""D3.6 — Pattern D triggered-event bus (scaffold).

Pattern D abilities fire in response to game-lifecycle events (start of round,
combat declared, figure defeated, etc.), not in response to direct
`dispatch.resolve(...)` calls. This module provides the INFRASTRUCTURE — a
synthetic event-emitter — that future slices wire real handlers into. Today
every Pattern D ability registers a *stub* that raises `TriggerNotImplemented`
when fired, so nothing executes silently.

**What this module lands:**
  - `_LIBRARY_TRIGGERS` — frozenset of every trigger string observed in the
    live `data/ability-library.json` (42 distinct values). Registering a
    handler under any other string raises `UnknownTriggerName`.
  - `register_trigger` / `unregister_ability` / `clear_bus` — mutator API.
  - `fire(game, trigger, event_ctx)` — iterate all handlers for a trigger in
    registration order, returning each handler's result. Propagates any
    exception (including `TriggerNotImplemented`) from the handler.
  - `fire_ability(game, ability_id, event_ctx)` — fire exactly one ability's
    handler by ID. Used by `dispatch.resolve(game, pattern_d_id, ctx)`.
  - `install_pattern_d_stubs()` — registers a stub for every Pattern D ID in
    the library. Idempotent. Required before the bus is populated.
  - `resolve_pattern_d(game, ability_id, ctx)` — the dispatch entry point
    (wired by `dispatch.install_default_handlers`). Routes through the bus.

**What this module does NOT do:**
  - Wire any real library-fed handler. All 161 Pattern D abilities are
    registered as stubs; firing a stub raises `TriggerNotImplemented`. Real
    handlers land in D3.7+ or D4 once the JS firing sites have been ported
    out of `src/handlers/*.js` / `src/engine/*.js` into Python equivalents.
  - Collapse camelCase vs kebab-case trigger aliases. Four groups of
    alias-looking names co-exist in the library (see `AMBIGUOUS_ALIAS_GROUPS`)
    and are kept as distinct triggers until the JS audit disambiguates them.
    Handlers bind to the exact string the JS firing site uses.
  - Mutate `game`. The stub raises; real handlers will mutate in D3.7+.

**Fail-loud surface:**
  - `UnknownTriggerName` — trigger string not in `_LIBRARY_TRIGGERS`.
  - `UnregisteredPatternD` — Pattern D ID not in `_ability_index`
    (library drift: classifier says D but `install_pattern_d_stubs` wasn't
    called, or the ID was unregistered and someone dispatched it).
  - `TriggerNotImplemented` — stub was fired (no real handler wired yet).
  - `ValueError` — `resolve_pattern_d` called on a non-D ability.
  - `UnknownAbility` — ability_id not in the library.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Tuple

from python.engine.abilities.classify import classify_ability
from python.engine.data.ability_library_loader import get_ability, get_ability_library


# ── Canonical trigger names ─────────────────────────────────────────────────
# Every trigger string observed on a Pattern D entry in the live library.
# Registering or firing any other string raises `UnknownTriggerName`.

_LIBRARY_TRIGGERS = frozenset({
    # round-scope
    'start-of-round', 'end-of-round', 'setup', 'mission-start',
    # activation-scope (both naming conventions preserved as distinct)
    'activation', 'activation-start', 'activation-end', 'end-of-activation',
    'startOfActivation', 'other-activation', 'once-per-activation',
    'friendly-activation',
    # attack/combat-scope
    'combat', 'combat-declare', 'combat-dice', 'combat-defense',
    'combat-after', 'combat-after-defending', 'post-combat',
    'pre-attack', 'attack-declare', 'declare-attack',
    'whenAttackDeclared', 'attack-declared-on-you',
    'ranged-attack-declared-on-you',
    'after-attack', 'after-ranged-attack',
    'when-targeted',
    # cross-figure combat
    'friendly-attack', 'after-friendly-attack',
    # damage / defeat
    'on-damage', 'on-defeat', 'pre-defeat', 'onDefeat',
    'friendly-defeat', 'on-hostile-defeat', 'strain',
    # movement
    'movement', 'movement-exit', 'movement-adjacent',
    # other
    'post-deploy', 'post-interact',
})


# Alias groups that LOOK like canonicalization errors in the JS library —
# kept for documentation. NOT collapsed: the bus treats each string as a
# distinct trigger. Handlers bind to the exact JS-firing string; porters
# can audit and collapse (or confirm distinct semantics) when real handlers
# land in D3.7+.
AMBIGUOUS_ALIAS_GROUPS: Tuple[Tuple[str, ...], ...] = (
    ('activation-start', 'startOfActivation'),                                 # 10 + 3
    ('activation-end', 'end-of-activation'),                                   # 1 + 2
    ('attack-declare', 'combat-declare', 'declare-attack', 'whenAttackDeclared'),  # 3 + 28 + 1 + 1
    ('on-defeat', 'onDefeat'),                                                 # 2 + 1
)


# ── Exceptions ──────────────────────────────────────────────────────────────

class TriggerNotImplemented(NotImplementedError):
    """A bus handler was fired but only a stub is registered."""

    def __init__(self, ability_id: str, trigger: str):
        super().__init__(
            f'Pattern D ability {ability_id!r} fired for trigger {trigger!r} '
            f'but handler is a stub (no real implementation wired yet — D3.7+/D4).'
        )
        self.ability_id = ability_id
        self.trigger = trigger


class UnknownTriggerName(ValueError):
    """A trigger string not in `_LIBRARY_TRIGGERS` was used."""

    def __init__(self, name: str):
        super().__init__(
            f'Unknown trigger name {name!r}. Canonical triggers: '
            f'{sorted(_LIBRARY_TRIGGERS)}.'
        )
        self.name = name


class UnregisteredPatternD(RuntimeError):
    """Pattern D ability is in the library but not registered in the bus."""

    def __init__(self, ability_id: str):
        super().__init__(
            f'Pattern D ability {ability_id!r} not registered in trigger bus. '
            f'Library drift or install_pattern_d_stubs() not called.'
        )
        self.ability_id = ability_id


# ── Bus state ───────────────────────────────────────────────────────────────

TriggerHandler = Callable[[Dict[str, Any], str, Dict[str, Any]], Dict[str, Any]]

# Primary index: trigger → [(ability_id, handler), ...] preserving registration order.
_bus: Dict[str, List[Tuple[str, TriggerHandler]]] = {}
# Reverse index: ability_id → (trigger, handler).
_ability_index: Dict[str, Tuple[str, TriggerHandler]] = {}


def _require_trigger(trigger: str) -> None:
    if trigger not in _LIBRARY_TRIGGERS:
        raise UnknownTriggerName(trigger)


def register_trigger(trigger: str, ability_id: str, handler: TriggerHandler) -> None:
    """Install a handler for a Pattern D ability under a trigger.

    If the ability was previously registered under a different trigger, the
    old registration is dropped first (a handler owns exactly one slot).
    """
    _require_trigger(trigger)
    prev = _ability_index.get(ability_id)
    if prev is not None:
        prev_trigger, _ = prev
        _bus[prev_trigger] = [
            (aid, h) for aid, h in _bus.get(prev_trigger, []) if aid != ability_id
        ]
        if not _bus[prev_trigger]:
            del _bus[prev_trigger]
    _bus.setdefault(trigger, []).append((ability_id, handler))
    _ability_index[ability_id] = (trigger, handler)


def unregister_ability(ability_id: str) -> None:
    """Drop an ability's registration. No-op if not registered."""
    prev = _ability_index.pop(ability_id, None)
    if prev is None:
        return
    trigger, _ = prev
    _bus[trigger] = [(aid, h) for aid, h in _bus.get(trigger, []) if aid != ability_id]
    if not _bus[trigger]:
        del _bus[trigger]


def clear_bus() -> None:
    """Drop every registration. Tests use this for clean-slate invariants."""
    _bus.clear()
    _ability_index.clear()


def get_handler_for(ability_id: str) -> Optional[Tuple[str, TriggerHandler]]:
    """Return `(trigger, handler)` for an ability, or None if unregistered.

    Useful for introspection: `pattern_d_is_stub('on-defeat', 'ability_id')`
    without firing the handler.
    """
    return _ability_index.get(ability_id)


def get_handlers_for_trigger(trigger: str) -> List[Tuple[str, TriggerHandler]]:
    """Return `[(ability_id, handler), ...]` for all abilities on a trigger."""
    _require_trigger(trigger)
    return list(_bus.get(trigger, []))


# ── Firing ──────────────────────────────────────────────────────────────────

def fire(game: Dict[str, Any],
         trigger: str,
         event_ctx: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Fire every handler registered under `trigger` in registration order.

    Returns a list of each handler's result. Propagates any exception the
    handler raises — including `TriggerNotImplemented` from a stub. The
    caller is responsible for catching / swallowing as appropriate.

    `event_ctx` is augmented with the trigger name before each handler call.
    """
    _require_trigger(trigger)
    ctx = {**(event_ctx or {}), 'trigger': trigger}
    results: List[Dict[str, Any]] = []
    for ability_id, handler in _bus.get(trigger, []):
        results.append(handler(game, ability_id, ctx))
    return results


def fire_ability(game: Dict[str, Any],
                 ability_id: str,
                 event_ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Fire exactly one ability's handler (bypasses trigger-wide dispatch).

    Raises `UnregisteredPatternD` if the ability has no slot in the bus.
    """
    info = _ability_index.get(ability_id)
    if info is None:
        raise UnregisteredPatternD(ability_id)
    trigger, handler = info
    ctx = {**(event_ctx or {}), 'trigger': trigger}
    return handler(game, ability_id, ctx)


# ── Stubs ───────────────────────────────────────────────────────────────────

def _make_stub(ability_id: str, trigger: str) -> TriggerHandler:
    """Build a sentinel handler that raises `TriggerNotImplemented` on fire.

    Each stub captures the ability_id + declared trigger so the raised
    exception includes full context for the audit trail.
    """
    def stub(game: Dict[str, Any],
             ab_id: str,
             ctx: Dict[str, Any]) -> Dict[str, Any]:
        raise TriggerNotImplemented(ab_id, ctx.get('trigger', trigger))
    stub.__name__ = f'stub_{ability_id}'
    stub.__qualname__ = f'pattern_d.stub:{ability_id}'
    return stub


def is_stub(handler: TriggerHandler) -> bool:
    """True iff `handler` is one of the sentinels produced by `_make_stub`."""
    return getattr(handler, '__qualname__', '').startswith('pattern_d.stub:')


def install_pattern_d_stubs() -> Dict[str, Any]:
    """Register a stub for every Pattern D ability in the library.

    Idempotent — the re-registration path in `register_trigger` replaces the
    prior stub. Returns a summary dict:
        {
          'registered': int,
          'triggers_used': int,
          'runnable_now': int,   # abilities whose handler is NOT a stub
          'stub_count': int,     # abilities whose handler IS a stub
        }
    """
    lib = get_ability_library()
    registered = 0
    for ability_id, entry in lib.items():
        pattern, _ = classify_ability(ability_id, entry)
        if pattern != 'D':
            continue
        trigger = entry.get('trigger')
        if trigger is None:
            # classifier returned D only if trigger is set — should never hit.
            raise RuntimeError(
                f'Pattern D classification contract violated: {ability_id!r} '
                f'classified D but entry has no trigger.'
            )
        if trigger not in _LIBRARY_TRIGGERS:
            raise UnknownTriggerName(trigger)
        register_trigger(trigger, ability_id, _make_stub(ability_id, trigger))
        registered += 1
    runnable = sum(1 for _, (_, h) in _ability_index.items() if not is_stub(h))
    stub_count = sum(1 for _, (_, h) in _ability_index.items() if is_stub(h))
    return {
        'registered': registered,
        'triggers_used': len(_bus),
        'runnable_now': runnable,
        'stub_count': stub_count,
    }


# ── Dispatch entry point ────────────────────────────────────────────────────

def resolve_pattern_d(game: Dict[str, Any],
                      ability_id: str,
                      ctx: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Pattern D dispatch — routes through the trigger bus.

    Raises:
        UnknownAbility         — ability_id not in library.
        ValueError             — ability is not Pattern D.
        UnregisteredPatternD   — Pattern D but no bus registration (drift).
        TriggerNotImplemented  — only a stub is registered (D3.6 default).
    """
    entry = get_ability(ability_id)
    if entry is None:
        from python.engine.abilities.dispatch import UnknownAbility
        raise UnknownAbility(ability_id)
    pattern, _reason = classify_ability(ability_id, entry)
    if pattern != 'D':
        raise ValueError(
            f'resolve_pattern_d called on ability {ability_id!r} '
            f'(pattern {pattern}); route via dispatch.resolve()'
        )
    return fire_ability(game, ability_id, ctx)


# ── Introspection helpers ───────────────────────────────────────────────────

def pattern_d_registered_ids() -> List[str]:
    """All Pattern D ability IDs currently registered in the bus."""
    return sorted(_ability_index.keys())


def pattern_d_runnable_ids() -> List[str]:
    """Pattern D abilities whose registered handler is NOT a stub."""
    return sorted(aid for aid, (_, h) in _ability_index.items() if not is_stub(h))


def pattern_d_stub_ids() -> List[str]:
    """Pattern D abilities still backed by a stub (no real handler wired)."""
    return sorted(aid for aid, (_, h) in _ability_index.items() if is_stub(h))


def pattern_d_trigger_counts() -> Dict[str, int]:
    """Return trigger → count over the current registrations."""
    counts: Dict[str, int] = {}
    for trigger, entries in _bus.items():
        counts[trigger] = len(entries)
    return counts


def pattern_d_ambiguous_trigger_ids() -> List[str]:
    """Ability IDs whose trigger name belongs to an alias group that still
    needs JS audit to canonicalize. Documentation helper only — these
    abilities are still registered (with stubs) under the exact string from
    the library."""
    ambiguous_names = {name for group in AMBIGUOUS_ALIAS_GROUPS for name in group}
    return sorted(
        aid for aid, (trigger, _) in _ability_index.items()
        if trigger in ambiguous_names
    )
