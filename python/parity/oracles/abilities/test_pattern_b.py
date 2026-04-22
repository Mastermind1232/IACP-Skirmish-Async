"""D3.4 oracle — Pattern B surge handler.

Exercises the shared wrapper over `parse_surge_effect`:
  - All 51 Pattern B IDs resolve cleanly through the handler
  - Numeric comma-surges (damage N, pierce N, accuracy N, blast N, cleave N)
    accumulate correctly
  - Named-effect surges (deadly_spin, critical_hit, concussive_bolt, …) set
    their respective flags
  - Composite keys (`+1 hit, pierce 1`, `accuracy 2, damage 2`) combine
  - `+3 damage` parses to zero-modifier in BOTH engines (JS parity bug —
    `parseSurgeEffect` regex only matches `damage N` and `+N hit`); oracle
    pins the current shared behavior
  - UnsupportedPatternBField fires when a stray field is added
  - Wrong-pattern + unknown-ability produce the right exception types
  - Dispatch registry routes Pattern B through the handler
  - install_default_handlers now wires both A and B

Run as: python3 -m python.parity.oracles.abilities.test_pattern_b
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
    resolve,
)
from python.engine.abilities.pattern_b import (
    UnsupportedPatternBField,
    pattern_b_ids_all_handled,
    resolve_pattern_b,
)
from python.engine.data.ability_library_loader import get_ability_library
from python.engine.mechanics.surge import parse_surge_effect


# ── Result shape ────────────────────────────────────────────────────────────

def test_result_dict_shape():
    r = resolve_pattern_b({}, '+1 hit', {})
    assert set(r.keys()) == {'ability_id', 'pattern', 'surge_cost', 'modifiers'}
    assert r['ability_id'] == '+1 hit'
    assert r['pattern'] == 'B'
    assert r['surge_cost'] == 1
    assert isinstance(r['modifiers'], dict)


def test_modifiers_have_numeric_defaults():
    r = resolve_pattern_b({}, 'stun', {})
    mods = r['modifiers']
    for k in ('damage', 'pierce', 'accuracy', 'blast', 'recover', 'cleave'):
        assert k in mods, f'missing default {k}'
        assert isinstance(mods[k], int)
    assert 'conditions' in mods and isinstance(mods['conditions'], list)


# ── Numeric comma-surges ────────────────────────────────────────────────────

def test_plus_1_hit_damage_1():
    r = resolve_pattern_b({}, '+1 hit', {})
    assert r['modifiers']['damage'] == 1


def test_plus_2_hits_damage_2():
    r = resolve_pattern_b({}, '+2 hits', {})
    assert r['modifiers']['damage'] == 2


def test_damage_n():
    for n in (1, 2, 3, 4):
        r = resolve_pattern_b({}, f'damage {n}', {})
        assert r['modifiers']['damage'] == n, f'damage {n}'


def test_pierce_n():
    for n in (1, 2, 3):
        r = resolve_pattern_b({}, f'pierce {n}', {})
        assert r['modifiers']['pierce'] == n


def test_accuracy_n():
    for n in (1, 2, 3):
        r = resolve_pattern_b({}, f'accuracy {n}', {})
        assert r['modifiers']['accuracy'] == n


def test_blast_n():
    for n in (1, 2):
        r = resolve_pattern_b({}, f'blast {n}', {})
        assert r['modifiers']['blast'] == n


def test_cleave_n():
    for n in (1, 2):
        r = resolve_pattern_b({}, f'cleave {n}', {})
        assert r['modifiers']['cleave'] == n


# ── Conditions ──────────────────────────────────────────────────────────────

def test_stun_appends_condition():
    r = resolve_pattern_b({}, 'stun', {})
    assert r['modifiers']['conditions'] == ['Stun']


def test_bleed_appends_condition():
    r = resolve_pattern_b({}, 'bleed', {})
    assert r['modifiers']['conditions'] == ['Bleed']


def test_weaken_appends_condition():
    r = resolve_pattern_b({}, 'weaken', {})
    assert r['modifiers']['conditions'] == ['Weaken']


# ── Composite comma-surges ──────────────────────────────────────────────────

def test_hit_plus_pierce():
    r = resolve_pattern_b({}, '+1 hit, pierce 1', {})
    m = r['modifiers']
    assert m['damage'] == 1
    assert m['pierce'] == 1


def test_hit_plus_stun():
    r = resolve_pattern_b({}, '+1 hit, stun', {})
    m = r['modifiers']
    assert m['damage'] == 1
    assert m['conditions'] == ['Stun']


def test_accuracy_plus_damage():
    r = resolve_pattern_b({}, 'accuracy 2, damage 2', {})
    m = r['modifiers']
    assert m['damage'] == 2
    assert m['accuracy'] == 2


def test_damage_plus_hide_is_self_hide():
    r = resolve_pattern_b({}, 'damage 2, hide', {})
    m = r['modifiers']
    assert m['damage'] == 2
    assert m.get('surgeSelfHide') is True
    # hide inside combo is self-hide, NOT a condition on the target
    assert m['conditions'] == []


# ── Named-effect shortcuts ──────────────────────────────────────────────────

def test_deadly_spin_sets_cleave_3_and_cancel_dodge():
    r = resolve_pattern_b({}, 'deadly_spin', {})
    m = r['modifiers']
    assert m['cleave'] == 3
    assert m.get('surgeCancelDodge') is True


def test_critical_hit_sets_pierce_2_and_flag():
    r = resolve_pattern_b({}, 'critical_hit', {})
    m = r['modifiers']
    assert m['pierce'] == 2
    assert m.get('surgeCriticalHit') is True


def test_concussive_bolt_sets_flag():
    r = resolve_pattern_b({}, 'concussive_bolt', {})
    assert r['modifiers'].get('surgeConcussiveBolt') is True


def test_shrapnel_sets_blast_2():
    r = resolve_pattern_b({}, 'shrapnel', {})
    assert r['modifiers']['blast'] == 2


def test_shocking_palm_sets_replace_with_stun():
    r = resolve_pattern_b({}, 'shocking_palm', {})
    assert r['modifiers'].get('replaceWithStun') is True


def test_stun_net_appends_stun_condition():
    r = resolve_pattern_b({}, 'stun_net', {})
    assert r['modifiers']['conditions'] == ['Stun']


def test_focus_is_self_focus():
    r = resolve_pattern_b({}, 'focus', {})
    assert r['modifiers'].get('surgeSelfFocus') is True


def test_hide_is_self_hide():
    r = resolve_pattern_b({}, 'hide', {})
    assert r['modifiers'].get('surgeSelfHide') is True


# ── Recover surges ──────────────────────────────────────────────────────────

def test_recover_n():
    for n in (1, 2, 3):
        r = resolve_pattern_b({}, f'recover {n}', {})
        assert r['modifiers']['recover'] == n


# ── JS-parity-preserved edge: "+3 damage" regex miss ───────────────────────

def test_plus_3_damage_parses_to_zero_modifier():
    # Both JS parseSurgeEffect and Python parse_surge_effect fall through the
    # regex chain for "+N damage" because only "damage N" and "+N hit[s]" are
    # matched. This test pins the shared behavior — if the upstream regex is
    # fixed in BOTH engines, this assertion flips.
    r = resolve_pattern_b({}, '+3 damage', {})
    m = r['modifiers']
    assert m['damage'] == 0, 'If this fails, the JS+Python regex was fixed — good, but update oracle.'
    assert m['pierce'] == 0
    assert m['accuracy'] == 0


# ── Fail loudly: stray field ────────────────────────────────────────────────

def test_stray_field_raises_UnsupportedPatternBField():
    # Simulate library drift: surge-shaped entry that also carries chooseOne.
    # Patch the live library cache so both pattern_b.get_ability and
    # classify.classify_ability see the synthetic entry.
    from python.engine.data import ability_library_loader
    ability_library_loader.get_ability_library()  # force load
    lib = ability_library_loader._library
    assert lib is not None
    stub_id = '__drift_probe__'
    stub_entry = {
        'type': 'surge',
        'surgeCost': 1,
        'label': 'drifted',
        'chooseOne': [{'applyFocus': True}],  # illegal on Pattern B
    }
    lib[stub_id] = stub_entry
    try:
        try:
            resolve_pattern_b({}, stub_id, {})
        except UnsupportedPatternBField as e:
            assert e.ability_id == stub_id
            assert 'chooseOne' in e.fields
            return
        except ValueError as e:
            # classify_ability routes ccEffect-shaped drift to E; surge-typed
            # drift stays B and hits the allowlist. Either loud fail is OK.
            assert 'Pattern' in str(e)
            return
        assert False, 'expected UnsupportedPatternBField or ValueError'
    finally:
        lib.pop(stub_id, None)


# ── Fail loudly: wrong pattern, unknown ability ────────────────────────────

def test_wrong_pattern_raises_ValueError():
    try:
        resolve_pattern_b({}, 'Focus', {})  # classified A
    except ValueError as e:
        assert 'Pattern B' in str(e) or 'pattern_b' in str(e)
        return
    assert False


def test_unknown_ability_raises_UnknownAbility():
    try:
        resolve_pattern_b({}, 'NotASurge-ZZZ', {})
    except UnknownAbility:
        return
    assert False


# ── Dispatch registry integration ───────────────────────────────────────────

def test_dispatch_has_pattern_B_handler():
    h = get_handler('B')
    assert h is not None
    assert h.__name__ == 'resolve_pattern_b'


def test_dispatch_summary_reports_B_handler():
    s = dispatch_summary()
    assert s['registry']['B'] is not None
    # Pattern A + C + D registered post-D3.6; E wired post-D3.8 (chain registry).
    assert s['registry']['A'] is not None
    assert s['registry']['C'] is not None
    assert s['registry']['D'] is not None
    assert s['registry']['E'] is not None


def test_resolve_routes_Pattern_B_through_handler():
    out = resolve({}, 'pierce 2', {})
    assert out['pattern'] == 'B'
    assert out['modifiers']['pierce'] == 2


def test_lookup_pattern_returns_B_for_surge():
    assert lookup_pattern('deadly_spin') == 'B'


def test_install_default_handlers_idempotent_with_B():
    install_default_handlers()
    install_default_handlers()
    assert get_handler('A') is not None
    assert get_handler('B') is not None


# ── Parser-parity: direct parse matches handler output ─────────────────────

def test_handler_modifiers_match_direct_parse():
    # Sanity: the wrapper adds no transformation beyond parse_surge_effect.
    for aid in ('+1 hit', 'pierce 2', 'deadly_spin', 'accuracy 2, damage 2'):
        direct = parse_surge_effect(aid)
        via_handler = resolve_pattern_b({}, aid, {})['modifiers']
        assert direct == via_handler, f'{aid}: drift between parse and handler'


# ── All 51 surge IDs resolve cleanly ────────────────────────────────────────

def test_all_51_pattern_b_ids_resolve():
    ids = pattern_b_ids_all_handled()
    assert len(ids) == 51, f'expected 51 Pattern B IDs, got {len(ids)}'
    for aid in ids:
        r = resolve_pattern_b({}, aid, {})
        assert r['pattern'] == 'B', aid
        assert r['ability_id'] == aid
        assert r['surge_cost'] >= 1, f'{aid}: surge_cost={r["surge_cost"]}'
        assert isinstance(r['modifiers'], dict)
        assert isinstance(r['modifiers']['conditions'], list)


def test_damage_4_has_surge_cost_2():
    # Library outlier: `damage 4` costs 2 surges (balance tune).
    r = resolve_pattern_b({}, 'damage 4', {})
    assert r['surge_cost'] == 2
    assert r['modifiers']['damage'] == 4


def test_all_51_through_dispatch():
    ids = pattern_b_ids_all_handled()
    for aid in ids:
        out = resolve({}, aid, {})
        assert out['pattern'] == 'B', aid


# ── Pattern B count frozen at 51 ────────────────────────────────────────────

def test_pattern_b_count_is_51_in_library():
    lib = get_ability_library()
    surge_ids = [aid for aid, e in lib.items() if e.get('type') == 'surge']
    assert len(surge_ids) == 51


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
