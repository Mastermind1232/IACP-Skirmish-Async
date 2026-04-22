"""D3.6 oracle — Pattern D triggered-event bus scaffold.

Pattern D abilities react to lifecycle events, not direct `dispatch.resolve(...)`
calls. This oracle exercises the INFRASTRUCTURE landed in D3.6:

  - Trigger bus register / unregister / clear / fire semantics
  - Stub installation for all 161 Pattern D abilities (idempotent)
  - Fail-loud boundaries:
      UnknownTriggerName     — unknown trigger string
      UnregisteredPatternD   — Pattern D ability not in bus
      TriggerNotImplemented  — stub fired (real handler not wired yet)
      ValueError             — resolve_pattern_d on non-D ability
      UnknownAbility         — ability_id not in library
  - Dispatch integration: install_default_handlers wires A + B + C + D
  - `resolve(game, pattern_d_id, ctx)` routes through fire_ability and raises
    TriggerNotImplemented from the stub (proves no silent fallthrough)
  - Synthetic handler end-to-end proof that the bus executes

Intentionally NOT landed this slice (and therefore NOT tested):
  - Real library-fed handlers. Runnable-now subset is 0 by design.
  - Collapsing ambiguous alias groups. Catalogued; not auto-merged.
  - D4 handler/bridge port (JS-side trigger-firing sites).

Run as: python3 -m python.parity.oracles.abilities.test_pattern_d
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import (
    UnknownAbility,
    dispatch_summary,
    get_handler,
    install_default_handlers,
    lookup_pattern,
    resolve,
)
from python.engine.abilities.pattern_d import (
    AMBIGUOUS_ALIAS_GROUPS,
    TriggerNotImplemented,
    UnknownTriggerName,
    UnregisteredPatternD,
    _LIBRARY_TRIGGERS,
    clear_bus,
    fire,
    fire_ability,
    get_handler_for,
    get_handlers_for_trigger,
    install_pattern_d_stubs,
    is_stub,
    pattern_d_ambiguous_trigger_ids,
    pattern_d_registered_ids,
    pattern_d_runnable_ids,
    pattern_d_stub_ids,
    pattern_d_trigger_counts,
    register_trigger,
    resolve_pattern_d,
    unregister_ability,
)
from python.engine.abilities.classify import classify_ability, load_inventory
from python.engine.data.ability_library_loader import get_ability_library


# ── Test isolation helper ───────────────────────────────────────────────────
#
# Several tests mutate the bus (clear / register custom handlers / unregister).
# After each such test we restore the default stub registration so later tests
# see the populated bus. Wrapping in setup/teardown would be cleaner, but the
# suite runner here is a plain script — explicit restoration keeps dependencies
# one-file-only.

def _restore_stubs():
    clear_bus()
    install_pattern_d_stubs()


# ── Canonical trigger surface ───────────────────────────────────────────────

def test_library_triggers_covers_every_pattern_d_trigger():
    """Every trigger value that appears on a Pattern D library entry must be
    in `_LIBRARY_TRIGGERS`, or `install_pattern_d_stubs` would raise."""
    lib = get_ability_library()
    observed = set()
    for aid, e in lib.items():
        pattern, _ = classify_ability(aid, e)
        if pattern != 'D':
            continue
        trigger = e.get('trigger')
        assert trigger is not None, f'Pattern D {aid!r} has no trigger'
        observed.add(trigger)
    drift = observed - _LIBRARY_TRIGGERS
    assert not drift, f'Library triggers not in canonical set: {sorted(drift)}'
    # Contract: nothing in the canonical set is "dead weight" — every
    # canonical name must appear on at least one library entry. Otherwise
    # someone's added a speculative trigger.
    unused = _LIBRARY_TRIGGERS - observed
    assert not unused, f'Canonical triggers not observed in library: {sorted(unused)}'


def test_library_triggers_count_is_42():
    assert len(_LIBRARY_TRIGGERS) == 42


def test_ambiguous_alias_groups_catalogued():
    # Four groups that look like naming drift but are not auto-merged.
    # D3.7+ handlers will decide per-string semantics.
    assert len(AMBIGUOUS_ALIAS_GROUPS) == 4
    all_named = [name for group in AMBIGUOUS_ALIAS_GROUPS for name in group]
    # 2 + 2 + 4 + 2 = 10 names across the four groups.
    assert len(all_named) == 10
    # Every named alias must itself be in the canonical set (otherwise the
    # alias group is stale).
    for group in AMBIGUOUS_ALIAS_GROUPS:
        for name in group:
            assert name in _LIBRARY_TRIGGERS, \
                f'Alias group references non-canonical trigger: {name!r}'


# ── Registration / firing primitives ────────────────────────────────────────

def test_register_and_fire_synthetic_handler():
    """Proves the bus actually executes: not just catalog metadata.

    Clean-bus variant — stub firings are covered by their own test. Here we
    want an isolated end-to-end: register, fire, assert the handler ran with
    the expected ctx, and that the return value surfaces through `fire()`.
    """
    calls = []

    def syn(game, ability_id, ctx):
        calls.append((ability_id, ctx.get('trigger'), ctx.get('foo')))
        return {'ran': ability_id}

    clear_bus()
    try:
        register_trigger('start-of-round', 'syn_ability', syn)
        out = fire({}, 'start-of-round', {'foo': 42})
        assert out == [{'ran': 'syn_ability'}]
        assert calls == [('syn_ability', 'start-of-round', 42)]
    finally:
        _restore_stubs()


def test_register_unknown_trigger_raises():
    _restore_stubs()
    try:
        register_trigger('not-a-trigger', 'x', lambda g, a, c: {})
    except UnknownTriggerName as e:
        assert e.name == 'not-a-trigger'
        return
    assert False


def test_register_rebinds_to_new_trigger():
    _restore_stubs()
    calls = []

    def syn(game, ability_id, ctx):
        calls.append(ctx.get('trigger'))
        return {}

    try:
        register_trigger('start-of-round', 'mover', syn)
        assert get_handler_for('mover')[0] == 'start-of-round'
        # Rebind to a different trigger.
        register_trigger('end-of-round', 'mover', syn)
        assert get_handler_for('mover')[0] == 'end-of-round'
        # Old trigger should no longer contain 'mover'
        handlers = get_handlers_for_trigger('start-of-round')
        assert all(aid != 'mover' for aid, _ in handlers)
    finally:
        _restore_stubs()


def test_unregister_ability_drops_slot():
    _restore_stubs()
    try:
        register_trigger('setup', 'dropme', lambda g, a, c: {})
        assert get_handler_for('dropme') is not None
        unregister_ability('dropme')
        assert get_handler_for('dropme') is None
    finally:
        _restore_stubs()


def test_unregister_unknown_ability_is_noop():
    _restore_stubs()
    # Should not raise.
    unregister_ability('__never_registered__')


def test_clear_bus_drops_everything():
    _restore_stubs()
    try:
        clear_bus()
        assert get_handler_for('acp_scattergun') is None
        assert pattern_d_registered_ids() == []
    finally:
        _restore_stubs()


def test_get_handlers_for_trigger_preserves_registration_order():
    _restore_stubs()
    clear_bus()
    order = []
    try:
        def mk(label):
            def h(game, aid, ctx):
                order.append(aid)
                return {'label': label}
            return h
        register_trigger('start-of-round', 'first', mk('A'))
        register_trigger('start-of-round', 'second', mk('B'))
        register_trigger('start-of-round', 'third', mk('C'))
        out = fire({}, 'start-of-round', {})
        assert order == ['first', 'second', 'third']
        assert [r['label'] for r in out] == ['A', 'B', 'C']
    finally:
        _restore_stubs()


def test_fire_unknown_trigger_raises():
    try:
        fire({}, 'not-a-trigger', {})
    except UnknownTriggerName:
        return
    assert False


def test_fire_with_no_handlers_returns_empty_list():
    _restore_stubs()
    clear_bus()
    try:
        out = fire({}, 'start-of-round', {})
        assert out == []
    finally:
        _restore_stubs()


def test_fire_propagates_ctx_with_trigger_key():
    _restore_stubs()
    clear_bus()
    captured = []

    def syn(game, aid, ctx):
        captured.append(ctx)
        return {}

    try:
        register_trigger('setup', 'syn', syn)
        fire({}, 'setup', {'a': 1, 'b': 2})
        assert captured == [{'a': 1, 'b': 2, 'trigger': 'setup'}]
    finally:
        _restore_stubs()


# ── Stub surface ───────────────────────────────────────────────────────────

def test_fire_stub_raises_TriggerNotImplemented():
    _restore_stubs()
    # overwatch is a Pattern D ability with trigger 'combat-declare' — should
    # have a stub.
    info = get_handler_for('acp_scattergun')
    assert info is not None
    trigger, handler = info
    assert is_stub(handler)
    try:
        handler({}, 'acp_scattergun', {'trigger': trigger})
    except TriggerNotImplemented as e:
        assert e.ability_id == 'acp_scattergun'
        assert e.trigger == trigger
        return
    assert False


def test_is_stub_rejects_non_stub():
    _restore_stubs()
    def real(game, aid, ctx):
        return {}
    assert is_stub(real) is False
    clear_bus()
    try:
        register_trigger('setup', 'real_one', real)
        _, handler = get_handler_for('real_one')
        assert is_stub(handler) is False
    finally:
        _restore_stubs()


def test_install_pattern_d_stubs_registers_every_pattern_d_id():
    _restore_stubs()
    summary = install_pattern_d_stubs()
    assert summary['registered'] == 161
    assert summary['stub_count'] == 161
    assert summary['runnable_now'] == 0
    # Cross-check against the classifier inventory.
    inv = load_inventory()
    d_ids = sorted(aid for aid, info in inv.get('entries', {}).items()
                   if info.get('pattern') == 'D')
    assert len(d_ids) == 161
    registered = set(pattern_d_registered_ids())
    assert set(d_ids) == registered


def test_install_pattern_d_stubs_idempotent():
    _restore_stubs()
    s1 = install_pattern_d_stubs()
    s2 = install_pattern_d_stubs()
    assert s1 == s2 == {'registered': 161, 'stub_count': 161,
                        'runnable_now': 0, 'triggers_used': s1['triggers_used']}
    # No duplicates: ability index size equals registered count.
    assert len(pattern_d_registered_ids()) == 161


def test_install_pattern_d_stubs_uses_every_canonical_trigger():
    # Exactly those triggers actually observed on library entries should have
    # at least one registration. Unused canonical triggers were rejected by
    # `test_library_triggers_covers_every_pattern_d_trigger`.
    _restore_stubs()
    counts = pattern_d_trigger_counts()
    assert set(counts.keys()) == _LIBRARY_TRIGGERS
    assert sum(counts.values()) == 161


# ── Fail-loud ability-level dispatch ───────────────────────────────────────

def test_fire_ability_unknown_raises_UnregisteredPatternD():
    _restore_stubs()
    try:
        fire_ability({}, '__never_registered__', {})
    except UnregisteredPatternD as e:
        assert e.ability_id == '__never_registered__'
        return
    assert False


def test_resolve_pattern_d_raises_TriggerNotImplemented_for_stubbed():
    _restore_stubs()
    try:
        resolve_pattern_d({}, 'acp_scattergun', {})
    except TriggerNotImplemented as e:
        assert e.ability_id == 'acp_scattergun'
        return
    assert False


def test_resolve_pattern_d_wrong_pattern_raises_ValueError():
    _restore_stubs()
    try:
        resolve_pattern_d({}, 'Focus', {})  # Pattern A
    except ValueError as e:
        assert 'pattern_d' in str(e) or 'Pattern' in str(e)
        return
    assert False


def test_resolve_pattern_d_unknown_ability_raises_UnknownAbility():
    _restore_stubs()
    try:
        resolve_pattern_d({}, '__nope__', {})
    except UnknownAbility:
        return
    assert False


def test_resolve_pattern_d_drift_raises_UnregisteredPatternD():
    # Patch a synthetic Pattern D ability into the library WITHOUT re-running
    # install_pattern_d_stubs. resolve must raise UnregisteredPatternD, not
    # silently succeed or raise a subtler error.
    from python.engine.data import ability_library_loader
    ability_library_loader.get_ability_library()
    lib = ability_library_loader._library
    drift_id = '__drift_pattern_d__'
    drift_entry = {
        'type': 'dcSpecial',
        'trigger': 'start-of-round',
        'label': 'drifted',
        'category': 'active',
    }
    lib[drift_id] = drift_entry
    try:
        try:
            resolve_pattern_d({}, drift_id, {})
        except UnregisteredPatternD as e:
            assert e.ability_id == drift_id
            return
        assert False, 'expected UnregisteredPatternD for library-drift entry'
    finally:
        lib.pop(drift_id, None)
        # drift_id has no registration so no bus cleanup needed


# ── Dispatch integration ───────────────────────────────────────────────────

def test_dispatch_has_pattern_D_handler():
    _restore_stubs()
    h = get_handler('D')
    assert h is not None
    assert h.__name__ == 'resolve_pattern_d'


def test_dispatch_summary_reports_D_handler():
    _restore_stubs()
    s = dispatch_summary()
    assert s['registry']['A'] is not None
    assert s['registry']['B'] is not None
    assert s['registry']['C'] is not None
    assert s['registry']['D'] is not None
    assert s['registry']['E'] is not None  # D3.8: chain registry wired
    assert s['counts'] == {'A': 55, 'B': 51, 'C': 63, 'D': 161, 'E': 355}


def test_dispatch_resolve_routes_pattern_d_through_bus():
    _restore_stubs()
    try:
        resolve({}, 'acp_scattergun', {})
    except TriggerNotImplemented:
        return
    assert False, 'expected TriggerNotImplemented via dispatch.resolve'


def test_dispatch_resolve_unknown_ability_still_raises_UnknownAbility():
    _restore_stubs()
    try:
        resolve({}, 'NotAnAbility-ZZZ', {})
    except UnknownAbility:
        return
    assert False


def test_lookup_pattern_returns_D_for_triggered_abilities():
    _restore_stubs()
    assert lookup_pattern('acp_scattergun') == 'D'
    assert lookup_pattern('battle_meditation') == 'D'


def test_install_default_handlers_idempotent_with_D():
    install_default_handlers()
    install_default_handlers()
    assert get_handler('A') is not None
    assert get_handler('B') is not None
    assert get_handler('C') is not None
    assert get_handler('D') is not None
    # Re-installation should not duplicate bus entries.
    assert len(pattern_d_registered_ids()) == 161


# ── End-to-end proof via synthetic handler ─────────────────────────────────

def test_synthetic_handler_end_to_end_via_dispatch():
    """Full proof that the bus actually dispatches — not just registers.

    Swap one stub for a real handler, call dispatch.resolve(), verify the
    handler ran and returned its payload.
    """
    _restore_stubs()
    _, stub_handler = get_handler_for('acp_scattergun')
    assert is_stub(stub_handler)
    calls = []

    def real(game, aid, ctx):
        calls.append({'aid': aid, 'ctx': ctx})
        return {'pattern': 'D', 'ability_id': aid, 'ran_for_real': True}

    try:
        register_trigger('combat-declare', 'acp_scattergun', real)
        assert not is_stub(get_handler_for('acp_scattergun')[1])
        out = resolve({'g': 1}, 'acp_scattergun', {'attacker': 'A', 'defender': 'B'})
        assert out == {'pattern': 'D', 'ability_id': 'acp_scattergun', 'ran_for_real': True}
        assert len(calls) == 1
        assert calls[0]['aid'] == 'acp_scattergun'
        assert calls[0]['ctx']['attacker'] == 'A'
        assert calls[0]['ctx']['trigger'] == 'combat-declare'
    finally:
        _restore_stubs()


# ── Introspection counters ─────────────────────────────────────────────────

def test_pattern_d_registered_ids_is_161():
    _restore_stubs()
    assert len(pattern_d_registered_ids()) == 161


def test_pattern_d_runnable_ids_empty_after_stub_install():
    _restore_stubs()
    # Runnable = non-stub registered.
    assert pattern_d_runnable_ids() == []


def test_pattern_d_stub_ids_is_161():
    _restore_stubs()
    assert len(pattern_d_stub_ids()) == 161


def test_pattern_d_runnable_reflects_real_handler_swap():
    _restore_stubs()
    try:
        register_trigger('combat-declare', 'acp_scattergun',
                         lambda g, a, c: {'ran': True})
        runnable = pattern_d_runnable_ids()
        assert runnable == ['acp_scattergun']
        assert 'acp_scattergun' not in pattern_d_stub_ids()
        assert len(pattern_d_stub_ids()) == 160
    finally:
        _restore_stubs()


def test_pattern_d_trigger_counts_sum_to_161():
    _restore_stubs()
    counts = pattern_d_trigger_counts()
    assert sum(counts.values()) == 161


def test_pattern_d_ambiguous_trigger_ids_distribution():
    _restore_stubs()
    ambiguous_names = {name for group in AMBIGUOUS_ALIAS_GROUPS for name in group}
    ambiguous_ids = pattern_d_ambiguous_trigger_ids()
    counts = pattern_d_trigger_counts()
    expected = sum(counts.get(name, 0) for name in ambiguous_names)
    assert len(ambiguous_ids) == expected
    assert expected > 0, 'ambiguous-alias buckets should cover multiple abilities'


# ── Coverage pins ───────────────────────────────────────────────────────────

def test_pattern_d_count_frozen_at_161_in_library():
    from python.engine.abilities.classify import classify_ability
    lib = get_ability_library()
    d_count = sum(1 for aid, e in lib.items()
                  if classify_ability(aid, e)[0] == 'D')
    assert d_count == 161, f'Pattern D count drifted: {d_count}'


def test_every_pattern_d_id_routes_through_dispatch_to_TriggerNotImplemented():
    """Every one of the 161 Pattern D IDs must, when resolved via the public
    `dispatch.resolve(...)` API, raise TriggerNotImplemented — no silent
    success and no other exception type."""
    _restore_stubs()
    lib = get_ability_library()
    d_ids = sorted(aid for aid, e in lib.items()
                   if classify_ability(aid, e)[0] == 'D')
    assert len(d_ids) == 161
    for aid in d_ids:
        try:
            resolve({}, aid, {})
        except TriggerNotImplemented:
            continue
        except Exception as e:
            raise AssertionError(
                f'{aid}: expected TriggerNotImplemented, got '
                f'{type(e).__name__}: {e}'
            )
        raise AssertionError(f'{aid}: no exception raised (silent success)')


# ── Runner ──────────────────────────────────────────────────────────────────

def main():
    tests = [v for k, v in sorted(globals().items())
             if k.startswith('test_') and callable(v)]
    passed = 0
    for t in tests:
        try:
            t()
            passed += 1
            print(f'PASS {t.__name__}')
        except AssertionError as e:
            print(f'FAIL {t.__name__}: {e}')
            sys.exit(1)
        except Exception as e:
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
