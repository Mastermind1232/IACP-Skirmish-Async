"""D3.2 oracle — ability dispatch registry scaffold.

Exercises `python.engine.abilities.dispatch`:
  - UnknownAbility raised on unknown ID
  - lookup_pattern returns the right letter for known IDs, raises on unknown
  - Pattern A handler is auto-installed (install_default_handlers on import)
  - B wired post-D3.4; C wired post-D3.5; D wired (stub bus) post-D3.6;
    E wired (registry) post-D3.8. Scaffold semantics are now a post-slice
    snapshot — each pattern's live status is asserted here so future passes
    can't silently regress.
  - register() validates pattern letter
  - dispatch_summary reports registry + counts consistently

Run as: python3 -m python.parity.oracles.abilities.test_dispatch_scaffold
"""
import sys

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import (
    PatternNotImplemented,
    UnknownAbility,
    dispatch_summary,
    get_handler,
    install_default_handlers,
    lookup_pattern,
    register,
    resolve,
    unregister,
)


# ── Unknown / invalid ──────────────────────────────────────────────────────

def test_resolve_unknown_ability_raises_UnknownAbility():
    try:
        resolve({}, 'NotAnAbility-ZZZ', {})
    except UnknownAbility:
        return
    assert False


def test_lookup_pattern_unknown_raises_UnknownAbility():
    try:
        lookup_pattern('NotAnAbility-ZZZ')
    except UnknownAbility:
        return
    assert False


def test_register_invalid_pattern_raises():
    try:
        register('Z', lambda g, a, c: {})
    except ValueError:
        return
    assert False


# ── lookup_pattern ──────────────────────────────────────────────────────────

def test_lookup_pattern_returns_A_for_Focus():
    assert lookup_pattern('Focus') == 'A'


def test_lookup_pattern_returns_E_for_Force_Push():
    assert lookup_pattern('Force Push') == 'E'


# ── Pattern A handler installed by default ─────────────────────────────────

def test_pattern_A_handler_installed_on_import():
    # install_default_handlers was called at module import time.
    handler = get_handler('A')
    assert handler is not None
    assert handler.__name__ == 'resolve_pattern_a'


def test_install_default_handlers_idempotent():
    install_default_handlers()
    install_default_handlers()  # second call must not raise or duplicate
    assert get_handler('A') is not None


# ── B/C/D/E per-pattern live-status assertions (post-D3.4/5/6/8) ────────────

def test_pattern_B_resolves_cleanly_post_D3_4():
    # D3.4 wired Pattern B through resolve_pattern_b. Scaffold semantics have
    # moved: B no longer raises PatternNotImplemented.
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    b_ids = [aid for aid, e in lib.items() if e.get('type') == 'surge']
    assert b_ids
    out = resolve({}, b_ids[0], {})
    assert out['pattern'] == 'B'


def test_pattern_C_resolves_cleanly_post_D3_5():
    # D3.5 wired Pattern C via resolve_pattern_c (passive-aura acknowledgement).
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    c_ids = [aid for aid, e in lib.items() if e.get('type') == 'dcPassive']
    assert c_ids
    out = resolve({}, c_ids[0], {})
    assert out['pattern'] == 'C'


def test_pattern_D_raises_TriggerNotImplemented_post_D3_6():
    # D3.6 wired Pattern D bus. Scaffold semantics have moved: D no longer
    # raises PatternNotImplemented; dispatch.resolve() routes through the bus
    # and the registered stub raises TriggerNotImplemented instead. E still
    # raises PatternNotImplemented.
    # D3.7 update: 6 combat-declare abilities (acp_scattergun, battle_meditation,
    # find_weakness, full_of_rage, scattergun, sharpshooter) now have REAL
    # handlers, so we must pick a Pattern D ID that is still a stub. Use
    # `flawless_execution` — explicitly deferred in D3.7 (needs D4 choice plumbing).
    from python.engine.abilities.pattern_d import (
        TriggerNotImplemented,
        is_stub,
        get_handler_for,
    )
    info = get_handler_for('flawless_execution')
    assert info is not None, 'flawless_execution must be registered as a stub'
    assert is_stub(info[1]), 'flawless_execution must still be a stub post-D3.7'
    try:
        resolve({}, 'flawless_execution', {})
    except TriggerNotImplemented:
        return
    assert False


def test_pattern_E_force_push_resolves_post_D3_8():
    # D3.8 wired Pattern E via resolve_pattern_e + the per-ability chain
    # registry. 'Force Push' is the first chain landed; resolving it with no
    # chosen_* ctx fields exercises Phase 1 (enumerate SMALL figures within 3
    # of active DC) and must return cleanly with pattern='E'. A game with no
    # figures at all → `{applied: False, manualMessage: ...}` via the
    # "no SMALL figures within 3 spaces" fallback.
    out = resolve({'figurePositions': {1: {}, 2: {}}},
                  'Force Push',
                  {'player_num': 1, 'active_figure_keys': [], 'active_position': None})
    assert out['pattern'] == 'E'
    assert out.get('applied') is False
    assert 'manualMessage' in out


def test_unregistered_pattern_E_raises_ChainNotImplemented():
    # The remaining 349 Pattern E chains have no handler yet (post-D3.17:
    # Force Push + force_throw + hop_on_kuiil + wrist_cord + mandalorian_whip
    # + barrage_ct1701 registered; force_throw/wrist_cord/mandalorian_whip
    # share the generalized push-target-within-range handler). They must
    # raise `ChainNotImplemented` at dispatch time — never silently succeed.
    from python.engine.abilities.pattern_e import ChainNotImplemented
    # Pick any known Pattern E ability other than the six registered chains.
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library
    lib = get_ability_library()
    registered = {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }
    e_ids = []
    for aid, entry in lib.items():
        pat, _ = classify_ability(aid, entry)
        if pat == 'E' and aid not in registered:
            e_ids.append(aid)
            if len(e_ids) >= 3:
                break
    assert e_ids, 'expected at least one unregistered Pattern E ability'
    for aid in e_ids:
        try:
            resolve({}, aid, {})
        except ChainNotImplemented as exc:
            assert exc.ability_id == aid
            continue
        assert False, f'expected ChainNotImplemented for {aid!r}'


# ── register / unregister round trip ────────────────────────────────────────

def test_register_overwrites_prior():
    original = get_handler('A')
    calls = []

    def stub(game, ability_id, ctx):
        calls.append(ability_id)
        return {'stub': True}

    register('A', stub)
    try:
        out = resolve({}, 'Focus', {})
        assert out == {'stub': True}
        assert calls == ['Focus']
    finally:
        register('A', original)


def test_unregister_removes_handler_and_resolve_raises():
    original = get_handler('A')
    unregister('A')
    try:
        try:
            resolve({}, 'Focus', {})
        except PatternNotImplemented:
            pass
        else:
            assert False, 'expected PatternNotImplemented after unregister'
    finally:
        register('A', original)


# ── dispatch_summary ────────────────────────────────────────────────────────

def test_dispatch_summary_shape():
    s = dispatch_summary()
    assert s['total'] == 685
    assert set(s['registry'].keys()) == {'A', 'B', 'C', 'D', 'E'}
    assert s['registry']['A'] is not None
    assert s['registry']['B'] is not None  # D3.4: Pattern B now wired
    assert s['registry']['C'] is not None  # D3.5: Pattern C acknowledgement now wired
    assert s['registry']['D'] is not None  # D3.6: Pattern D trigger bus now wired
    assert s['registry']['E'] is not None  # D3.8: Pattern E chain registry now wired (Force Push)
    assert s['counts'] == {'A': 55, 'B': 51, 'C': 63, 'D': 161, 'E': 355}


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
