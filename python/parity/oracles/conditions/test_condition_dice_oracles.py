"""Port of tests/domain/oracle/condition-dice-oracles.test.js — behavioral subset (D6.8d).

Ports the B-CONDDICE-001..004 behavioral describes that encode rules for
`apply_condition_with_die`: the Pattern A / Pattern B "become [Cond] → gain
+1 [die color]" shortcut used at 5 combat.js sites.

The ORACLE-CONDDICE-001..005 STRUCTURAL probes (JS-source migration pins that
read src/handlers/combat.js for `applyConditionWithDie(` call sites) are NOT
portable — they assert JS-file migration state, not engine behavior.

Run as: python3 -m python.parity.oracles.conditions.test_condition_dice_oracles
"""
import sys

from python.engine.mechanics.conditions import apply_condition_with_die


# ── B-CONDDICE-001: apply_condition_with_die applies condition and adds die ──

def test_001a_adds_green_die_when_focus_newly_applied():
    game = {'figureConditions': {}}
    attack_info = {'dice': ['blue', 'red']}
    r = apply_condition_with_die(game, 'Trooper-1-0', 'Focus', attack_info, 'green')
    assert r['applied'] is True
    assert r['attackInfo']['dice'] == ['blue', 'red', 'green']
    assert 'Focus' in game['figureConditions']['Trooper-1-0']


def test_001b_no_die_when_already_focused():
    game = {'figureConditions': {'Trooper-1-0': ['Focus']}}
    attack_info = {'dice': ['blue', 'red']}
    r = apply_condition_with_die(game, 'Trooper-1-0', 'Focus', attack_info, 'green')
    assert r['applied'] is False
    assert r['attackInfo']['dice'] == ['blue', 'red']


def test_001c_initializes_dice_when_attack_info_has_none():
    game = {'figureConditions': {}}
    attack_info = {}
    r = apply_condition_with_die(game, 'Zuckuss-1-0', 'Focus', attack_info, 'green')
    assert r['applied'] is True
    assert r['attackInfo']['dice'] == ['green']


def test_001d_does_not_mutate_original_attack_info():
    game = {'figureConditions': {}}
    original_dice = ['blue', 'red']
    attack_info = {'dice': original_dice}
    r = apply_condition_with_die(game, 'Trooper-1-0', 'Focus', attack_info, 'green')
    assert r['applied'] is True
    assert original_dice == ['blue', 'red'], 'original dice list not mutated'
    assert r['attackInfo'] is not attack_info, 'returned attackInfo is a new dict'


def test_001e_works_for_non_focus_conditions():
    game = {'figureConditions': {}}
    attack_info = {'dice': ['red']}
    r = apply_condition_with_die(game, 'Hunter-1-0', 'Hide', attack_info, 'white')
    assert r['applied'] is True
    assert r['attackInfo']['dice'] == ['red', 'white']
    assert 'Hide' in game['figureConditions']['Hunter-1-0']


# ── B-CONDDICE-002: Pattern B — not-already-Focused path ────────────────────

def test_002_pattern_b_applies_focus_plus_die_when_not_focused():
    game = {'figureConditions': {}}
    pending_attack_info = {'dice': ['blue', 'red', 'green']}
    r = apply_condition_with_die(game, 'Diala-1-0', 'Focus', pending_attack_info, 'green')
    assert r['applied'] is True
    assert r['attackInfo']['dice'] == ['blue', 'red', 'green', 'green']
    assert 'Focus' in game['figureConditions']['Diala-1-0']


# ── B-CONDDICE-003: Pattern B — already-Focused path ────────────────────────

def test_003_pattern_b_rejects_focus_plus_die_when_already_focused():
    game = {'figureConditions': {'Krrsantan-1-0': ['Focus']}}
    pending_attack_info = {'dice': ['red', 'green']}
    r = apply_condition_with_die(game, 'Krrsantan-1-0', 'Focus', pending_attack_info, 'green')
    assert r['applied'] is False
    assert r['attackInfo']['dice'] == ['red', 'green']


# ── B-CONDDICE-004: pendingCombat.attackInfo assignment discipline ──────────

def test_004a_caller_assigns_returned_attack_info_when_applied():
    game = {
        'figureConditions': {},
        'pendingCombat': {'attackInfo': {'dice': ['blue', 'red']}},
    }
    r = apply_condition_with_die(
        game, 'DarkTrooper-1-0', 'Focus', game['pendingCombat']['attackInfo'], 'green'
    )
    if r['applied']:
        game['pendingCombat']['attackInfo'] = r['attackInfo']
    assert game['pendingCombat']['attackInfo']['dice'] == ['blue', 'red', 'green']
    assert game['pendingCombat']['attackInfo'] is not None


def test_004b_original_attack_info_unchanged_when_already_focused():
    game = {
        'figureConditions': {'Fennec-1-0': ['Focus']},
        'pendingCombat': {'attackInfo': {'dice': ['blue', 'green']}},
    }
    original_ref = game['pendingCombat']['attackInfo']
    r = apply_condition_with_die(
        game, 'Fennec-1-0', 'Focus', game['pendingCombat']['attackInfo'], 'green'
    )
    if r['applied']:
        game['pendingCombat']['attackInfo'] = r['attackInfo']
    assert game['pendingCombat']['attackInfo'] is original_ref
    assert game['pendingCombat']['attackInfo']['dice'] == ['blue', 'green']


ALL_TESTS = [
    test_001a_adds_green_die_when_focus_newly_applied,
    test_001b_no_die_when_already_focused,
    test_001c_initializes_dice_when_attack_info_has_none,
    test_001d_does_not_mutate_original_attack_info,
    test_001e_works_for_non_focus_conditions,
    test_002_pattern_b_applies_focus_plus_die_when_not_focused,
    test_003_pattern_b_rejects_focus_plus_die_when_already_focused,
    test_004a_caller_assigns_returned_attack_info_when_applied,
    test_004b_original_attack_info_unchanged_when_already_focused,
]


def _main() -> int:
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
            print(f'PASS  {t.__name__}')
        except AssertionError as e:
            failures += 1
            print(f'FAIL  {t.__name__}: {e}')
        except Exception as e:
            failures += 1
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
    total = len(ALL_TESTS)
    print(f'\n{total - failures}/{total} passed')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(_main())
