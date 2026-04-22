"""Tests for vp_helpers — award/deduct + Nefarious Gains (Jabba the Hutt)."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.vp_helpers import (
    award_kill_vp,
    award_objective_vp,
    check_nefarious_gains,
    deduct_vp,
)


def test_award_kill_vp_initializes_and_increments():
    g = {}
    award_kill_vp(g, 1, 5)
    assert g['player1VP'] == {'total': 5, 'kills': 5, 'objectives': 0}


def test_award_objective_vp_increments_objectives_and_total():
    g = {}
    award_objective_vp(g, 2, 3)
    assert g['player2VP'] == {'total': 3, 'kills': 0, 'objectives': 3}


def test_award_accumulates_across_calls():
    g = {}
    award_kill_vp(g, 1, 2)
    award_objective_vp(g, 1, 3)
    assert g['player1VP'] == {'total': 5, 'kills': 2, 'objectives': 3}


def test_deduct_vp_objectives_first_then_kills():
    g = {'player1VP': {'total': 10, 'kills': 4, 'objectives': 6}}
    deduct_vp(g, 1, 5)
    # Deducts 5 from objectives → objectives=1, kills=4, total=5
    assert g['player1VP'] == {'total': 5, 'kills': 4, 'objectives': 1}


def test_deduct_vp_clamps_at_zero():
    g = {'player1VP': {'total': 3, 'kills': 2, 'objectives': 1}}
    deduct_vp(g, 1, 10)
    assert g['player1VP'] == {'total': 0, 'kills': 0, 'objectives': 0}


def test_check_nefarious_gains_jabba_alive():
    g = {'figurePositions': {1: {}, 2: {'Jabba the Hutt-1-0': 'a1'}}}
    r = check_nefarious_gains(g, 1)
    assert r == {'jabbaOwnerPN': 2, 'vpTotal': 1}
    assert g['player2VP']['total'] == 1
    assert g['player2VP']['objectives'] == 1


def test_check_nefarious_gains_jabba_not_found_returns_none():
    g = {'figurePositions': {1: {}, 2: {}}}
    assert check_nefarious_gains(g, 1) is None


def test_check_nefarious_gains_jabba_on_same_side_as_defeated_no_award():
    g = {'figurePositions': {1: {'Jabba the Hutt-1-0': 'a1'}, 2: {}}}
    # defeated owner = 1, so we look at P2 for Jabba → not there → None
    assert check_nefarious_gains(g, 1) is None


def main():
    cases = [
        ('award_kill_vp_initializes', test_award_kill_vp_initializes_and_increments),
        ('award_objective_vp', test_award_objective_vp_increments_objectives_and_total),
        ('award_accumulates', test_award_accumulates_across_calls),
        ('deduct_objectives_first', test_deduct_vp_objectives_first_then_kills),
        ('deduct_clamps_at_zero', test_deduct_vp_clamps_at_zero),
        ('nefarious_jabba_alive', test_check_nefarious_gains_jabba_alive),
        ('nefarious_jabba_absent', test_check_nefarious_gains_jabba_not_found_returns_none),
        ('nefarious_jabba_wrong_side', test_check_nefarious_gains_jabba_on_same_side_as_defeated_no_award),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
