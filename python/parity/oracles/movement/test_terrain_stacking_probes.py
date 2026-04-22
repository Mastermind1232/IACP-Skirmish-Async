"""Port of tests/domain/oracle/terrain-stacking-probes.test.js (D6.8a).

Ports PROBE-TERRAIN-001 through 007. Skips PROBE-TERRAIN-008, which is a
JS-source pin (regex asserts on movement.js text) — that oracle has no
Python-side analogue, and its equivalent Python-source pin lives in the
parity harness for movement_cache.py (cost construction).

Mirrors the JS evaluate-movement-step cost construction exactly:
    baseCost = 1
    if entering_difficult (gated by !ignore_difficult) → extraCost += 1
    if entering_hostile and !ignore_figure_cost          → extraCost += 1

Run as: python3 -m python.parity.oracles.movement.test_terrain_stacking_probes
"""
import sys

from python.engine.mechanics.movement_board import (
    build_temp_board_state,
    profile_from_size,
)
from python.engine.mechanics.movement_cache import compute_movement_cache


# ── Minimal synthetic map: 3-cell corridor a1—a2—a3 ─────────────────────────
BASE_MAP = {
    'spaces': ['a1', 'a2', 'a3'],
    'adjacency': {'a1': ['a2'], 'a2': ['a1', 'a3'], 'a3': ['a2']},
    'terrain': {},
    'blocking': [],
    'movementBlockingEdges': [],
    'impassableEdges': [],
}


def _cost_to_a2(difficult=False, hostile=False, **profile_overrides):
    """Parity mirror of JS costToA2 helper in terrain-stacking-probes.test.js."""
    map_spaces = dict(BASE_MAP)
    map_spaces['terrain'] = {'a2': 'difficult'} if difficult else {}
    hostile_set = ['a2'] if hostile else None
    board = build_temp_board_state(map_spaces, [], hostile_set)
    profile = profile_from_size('1x1', **profile_overrides)
    cache = compute_movement_cache('a1', 10, board, profile)
    target = (cache.get('cells') or {}).get('a2')
    return target['cost'] if target else None


# ── PROBE-TERRAIN-001: baseline ─────────────────────────────────────────────

def test_probe_001_baseline_normal_cell_costs_1_mp():
    assert _cost_to_a2() == 1, 'entering a normal cell must cost exactly 1 MP'


# ── PROBE-TERRAIN-002: difficult alone ──────────────────────────────────────

def test_probe_002_difficult_alone_costs_2_mp():
    assert _cost_to_a2(difficult=True) == 2, (
        'entering a difficult-only cell must cost 2 MP (base 1 + difficult 1)')


# ── PROBE-TERRAIN-003: hostile alone ────────────────────────────────────────

def test_probe_003_hostile_alone_costs_2_mp():
    assert _cost_to_a2(hostile=True) == 2, (
        'entering a hostile-only cell must cost 2 MP (base 1 + hostile 1)')


# ── PROBE-TERRAIN-004: difficult + hostile stack ────────────────────────────

def test_probe_004_difficult_plus_hostile_stacks_to_3_mp():
    assert _cost_to_a2(difficult=True, hostile=True) == 3, (
        'stacked difficult+hostile must cost exactly 3 MP (pure additive)')


def test_probe_004_stack_equals_sum_of_increments():
    base = _cost_to_a2()
    diff_only = _cost_to_a2(difficult=True)
    host_only = _cost_to_a2(hostile=True)
    stacked = _cost_to_a2(difficult=True, hostile=True)
    expected = base + (diff_only - base) + (host_only - base)
    assert stacked == expected, (
        f'stack should be base + difficult_inc + hostile_inc, not max/clamp. '
        f'got {stacked}, expected {expected}')


# ── PROBE-TERRAIN-005: ignoreDifficult suppresses ONLY difficult ────────────

def test_probe_005_ignore_difficult_on_difficult_cell_is_1():
    assert _cost_to_a2(difficult=True, ignore_difficult=True) == 1, (
        'ignore_difficult on difficult-only cell → 1 MP')


def test_probe_005_ignore_difficult_on_stacked_still_pays_hostile():
    assert _cost_to_a2(difficult=True, hostile=True, ignore_difficult=True) == 2, (
        'ignore_difficult on stacked cell still pays hostile +1 → 2 MP')


# ── PROBE-TERRAIN-006: ignoreFigureCost suppresses ONLY hostile ─────────────

def test_probe_006_ignore_figure_cost_on_hostile_cell_is_1():
    assert _cost_to_a2(hostile=True, ignore_figure_cost=True) == 1, (
        'ignore_figure_cost on hostile-only cell → 1 MP')


def test_probe_006_ignore_figure_cost_on_stacked_still_pays_difficult():
    assert _cost_to_a2(difficult=True, hostile=True, ignore_figure_cost=True) == 2, (
        'ignore_figure_cost on stacked cell still pays difficult +1 → 2 MP')


# ── PROBE-TERRAIN-007: both ignores on stacked cell ─────────────────────────

def test_probe_007_both_ignores_on_stacked_cell_collapses_to_1():
    assert _cost_to_a2(
        difficult=True, hostile=True,
        ignore_difficult=True, ignore_figure_cost=True,
    ) == 1, (
        'both ignore_difficult and ignore_figure_cost on stacked cell → 1 MP')


ALL_TESTS = [
    test_probe_001_baseline_normal_cell_costs_1_mp,
    test_probe_002_difficult_alone_costs_2_mp,
    test_probe_003_hostile_alone_costs_2_mp,
    test_probe_004_difficult_plus_hostile_stacks_to_3_mp,
    test_probe_004_stack_equals_sum_of_increments,
    test_probe_005_ignore_difficult_on_difficult_cell_is_1,
    test_probe_005_ignore_difficult_on_stacked_still_pays_hostile,
    test_probe_006_ignore_figure_cost_on_hostile_cell_is_1,
    test_probe_006_ignore_figure_cost_on_stacked_still_pays_difficult,
    test_probe_007_both_ignores_on_stacked_cell_collapses_to_1,
]


def _main():
    ok, bad = 0, 0
    for t in ALL_TESTS:
        try:
            t()
            ok += 1
            print(f'  ok  {t.__name__}')
        except AssertionError as e:
            bad += 1
            print(f'  FAIL {t.__name__}: {e}')
    print(f'\n{ok}/{ok+bad} tests pass')
    sys.exit(0 if bad == 0 else 1)


if __name__ == '__main__':
    _main()
