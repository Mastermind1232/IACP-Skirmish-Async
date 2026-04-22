"""Port of tests/domain/oracle/multi-condition-probes.test.js (D6.8d).

Ports PROBE-COND-001..007 — multi-condition interaction probes for
apply_condition / filter_condition / reset_condition covering:
  001 co-existence of 3 distinct conditions on one figure
  002 dedup — second apply returns False, no duplicate stored
  003 independent removal — filter(X) keeps Y, Z
  004 per-figure isolation
  005 empty-array cleanup — last removal deletes the key
  006 Disarm-permanent-Weaken cross-condition guard
  007 reset_condition dedup-then-push

PROBE-COND-008 (JS-source pin on conditions.js regex shape) is NOT portable.

Run as: python3 -m python.parity.oracles.conditions.test_multi_condition_probes
"""
import sys

from python.engine.mechanics.conditions import (
    HARMFUL_CONDITIONS,
    apply_condition,
    filter_condition,
    reset_condition,
)


def _new_game():
    return {'figureConditions': {}}


# ── PROBE-COND-001: co-existence ────────────────────────────────────────────

def test_001a_three_distinct_conditions_coexist_in_order():
    g = _new_game()
    assert apply_condition(g, 'F-0-0', 'Focus') is True
    assert apply_condition(g, 'F-0-0', 'Bleed') is True
    assert apply_condition(g, 'F-0-0', 'Stun') is True
    assert g['figureConditions']['F-0-0'] == ['Focus', 'Bleed', 'Stun']


def test_001b_all_harmful_conditions_can_coexist():
    g = _new_game()
    for c in HARMFUL_CONDITIONS:
        apply_condition(g, 'F-0-0', c)
    assert len(g['figureConditions']['F-0-0']) == len(HARMFUL_CONDITIONS)
    for c in HARMFUL_CONDITIONS:
        assert c in g['figureConditions']['F-0-0']


# ── PROBE-COND-002: dedup ───────────────────────────────────────────────────

def test_002a_dedup_second_apply_returns_false():
    g = _new_game()
    assert apply_condition(g, 'F-0-0', 'Focus') is True
    assert apply_condition(g, 'F-0-0', 'Focus') is False
    assert g['figureConditions']['F-0-0'] == ['Focus']


def test_002b_dedup_is_per_condition_not_per_figure():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Focus')
    apply_condition(g, 'F-0-0', 'Focus')  # dedup
    assert apply_condition(g, 'F-0-0', 'Bleed') is True
    assert g['figureConditions']['F-0-0'] == ['Focus', 'Bleed']


# ── PROBE-COND-003: independent removal ─────────────────────────────────────

def test_003a_filter_one_keeps_others():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Focus')
    apply_condition(g, 'F-0-0', 'Bleed')
    apply_condition(g, 'F-0-0', 'Stun')
    filter_condition(g, 'F-0-0', 'Focus')
    assert g['figureConditions']['F-0-0'] == ['Bleed', 'Stun']


def test_003b_filter_non_present_is_noop():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Bleed')
    filter_condition(g, 'F-0-0', 'Focus')
    assert g['figureConditions']['F-0-0'] == ['Bleed']


# ── PROBE-COND-004: per-figure isolation ────────────────────────────────────

def test_004a_apply_to_x_does_not_touch_y():
    g = _new_game()
    apply_condition(g, 'X-0-0', 'Focus')
    apply_condition(g, 'X-0-0', 'Stun')
    assert g['figureConditions']['X-0-0'] == ['Focus', 'Stun']
    assert 'Y-0-0' not in g['figureConditions']


def test_004b_filter_on_x_does_not_affect_y():
    g = _new_game()
    apply_condition(g, 'X-0-0', 'Focus')
    apply_condition(g, 'Y-0-0', 'Focus')
    filter_condition(g, 'X-0-0', 'Focus')
    assert 'X-0-0' not in g['figureConditions']
    assert g['figureConditions']['Y-0-0'] == ['Focus']


# ── PROBE-COND-005: empty-array cleanup ─────────────────────────────────────

def test_005a_last_removal_deletes_the_key():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Focus')
    filter_condition(g, 'F-0-0', 'Focus')
    assert 'F-0-0' not in g['figureConditions']


def test_005b_removing_one_of_two_keeps_the_key():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Focus')
    apply_condition(g, 'F-0-0', 'Bleed')
    filter_condition(g, 'F-0-0', 'Focus')
    assert g['figureConditions']['F-0-0'] == ['Bleed']


# ── PROBE-COND-006: Disarm permanent Weaken ─────────────────────────────────

def test_006a_disarm_lock_blocks_weaken_removal():
    g = _new_game()
    g['disarmPermanentWeakened'] = {'F-0-0': True}
    apply_condition(g, 'F-0-0', 'Weaken')
    apply_condition(g, 'F-0-0', 'Stun')
    filter_condition(g, 'F-0-0', 'Weaken')
    assert 'Weaken' in g['figureConditions']['F-0-0']
    assert 'Stun' in g['figureConditions']['F-0-0']


def test_006b_disarm_lock_is_per_figure():
    g = _new_game()
    g['disarmPermanentWeakened'] = {'X-0-0': True}
    apply_condition(g, 'Y-0-0', 'Weaken')
    filter_condition(g, 'Y-0-0', 'Weaken')
    assert 'Y-0-0' not in g['figureConditions']


def test_006c_disarm_lock_does_not_block_other_conditions():
    g = _new_game()
    g['disarmPermanentWeakened'] = {'F-0-0': True}
    apply_condition(g, 'F-0-0', 'Weaken')
    apply_condition(g, 'F-0-0', 'Bleed')
    filter_condition(g, 'F-0-0', 'Bleed')
    assert 'Weaken' in g['figureConditions']['F-0-0']
    assert 'Bleed' not in g['figureConditions']['F-0-0']


# ── PROBE-COND-007: reset_condition ─────────────────────────────────────────

def test_007a_reset_on_absent_figure_adds_once():
    g = _new_game()
    reset_condition(g, 'F-0-0', 'Focus')
    assert g['figureConditions']['F-0-0'] == ['Focus']


def test_007b_reset_on_already_holding_leaves_single_instance():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Focus')
    reset_condition(g, 'F-0-0', 'Focus')
    assert g['figureConditions']['F-0-0'] == ['Focus']


def test_007c_reset_does_not_disturb_other_conditions():
    g = _new_game()
    apply_condition(g, 'F-0-0', 'Bleed')
    apply_condition(g, 'F-0-0', 'Focus')
    reset_condition(g, 'F-0-0', 'Focus')
    assert 'Bleed' in g['figureConditions']['F-0-0']
    assert 'Focus' in g['figureConditions']['F-0-0']
    assert len(g['figureConditions']['F-0-0']) == 2


ALL_TESTS = [
    test_001a_three_distinct_conditions_coexist_in_order,
    test_001b_all_harmful_conditions_can_coexist,
    test_002a_dedup_second_apply_returns_false,
    test_002b_dedup_is_per_condition_not_per_figure,
    test_003a_filter_one_keeps_others,
    test_003b_filter_non_present_is_noop,
    test_004a_apply_to_x_does_not_touch_y,
    test_004b_filter_on_x_does_not_affect_y,
    test_005a_last_removal_deletes_the_key,
    test_005b_removing_one_of_two_keeps_the_key,
    test_006a_disarm_lock_blocks_weaken_removal,
    test_006b_disarm_lock_is_per_figure,
    test_006c_disarm_lock_does_not_block_other_conditions,
    test_007a_reset_on_absent_figure_adds_once,
    test_007b_reset_on_already_holding_leaves_single_instance,
    test_007c_reset_does_not_disturb_other_conditions,
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
