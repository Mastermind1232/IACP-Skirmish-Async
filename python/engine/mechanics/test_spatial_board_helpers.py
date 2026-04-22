"""Tests for spatial + board_helpers leaf ports.

Run: python3 python/engine/mechanics/test_spatial_board_helpers.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.spatial import (
    INFINITY,
    count_spaces,
    get_all_figure_coords,
    is_within_spaces,
)
from python.engine.mechanics.board_helpers import (
    count_game_spaces,
    get_closed_door_edges,
)


def _mini_map():
    """4-cell chain: a1 <-> a2 <-> a3 <-> a4."""
    return {
        'adjacency': {
            'a1': ['a2'], 'a2': ['a1', 'a3'], 'a3': ['a2', 'a4'], 'a4': ['a3'],
        },
    }


def test_get_all_figure_coords_collects_both_players_lowercase():
    g = {'figurePositions': {1: {'L-1-0': 'A1', 'H-1-0': None}, 2: {'V-1-0': 'B2'}}}
    assert get_all_figure_coords(g) == {'a1', 'b2'}


def test_count_spaces_same_cell_zero():
    assert count_spaces(_mini_map(), 'a1', 'a1') == 0


def test_count_spaces_simple_chain():
    m = _mini_map()
    assert count_spaces(m, 'a1', 'a2') == 1
    assert count_spaces(m, 'a1', 'a3') == 2
    assert count_spaces(m, 'a1', 'a4') == 3


def test_count_spaces_unreachable_returns_infinity():
    m = {'adjacency': {'a1': [], 'a2': []}}
    assert count_spaces(m, 'a1', 'a2') == INFINITY


def test_count_spaces_blocked_edge_detours_or_blocks():
    # Chain with blocked edge between a2 and a3 → no path, infinity.
    m = _mini_map()
    blocked = {'a2|a3'}
    assert count_spaces(m, 'a1', 'a4', blocked) == INFINITY
    # Without blocking, 3 steps.
    assert count_spaces(m, 'a1', 'a4') == 3


def test_is_within_spaces_basic():
    m = _mini_map()
    assert is_within_spaces(m, 'a1', 'a3', 2) is True
    assert is_within_spaces(m, 'a1', 'a4', 2) is False  # needs 3 steps
    assert is_within_spaces(m, 'a1', 'a4', 3) is True


def test_get_closed_door_edges_no_map_returns_empty():
    assert get_closed_door_edges({}) == set()
    assert get_closed_door_edges({'selectedMap': {}}) == set()


def test_get_closed_door_edges_real_map():
    # mos-eisley-outskirts has doors in data/map-tokens.json; expect a non-empty set.
    g = {'selectedMap': {'id': 'mos-eisley-outskirts'}, 'openedDoors': []}
    edges = get_closed_door_edges(g)
    assert isinstance(edges, set)
    assert len(edges) >= 1  # has at least one door
    # All entries are canonical edge keys "a|b" with sorted endpoints
    for e in edges:
        parts = e.split('|')
        assert len(parts) == 2
        assert parts == sorted(parts)


def test_get_closed_door_edges_respects_opened():
    g = {'selectedMap': {'id': 'mos-eisley-outskirts'}, 'openedDoors': []}
    all_closed = get_closed_door_edges(g)
    if not all_closed:
        return
    first = next(iter(all_closed))
    a, b = first.split('|')
    g2 = {'selectedMap': {'id': 'mos-eisley-outskirts'}, 'openedDoors': [f'{a}|{b}']}
    assert first not in get_closed_door_edges(g2)
    # Also check the reverse-orientation opened entry works
    g3 = {'selectedMap': {'id': 'mos-eisley-outskirts'}, 'openedDoors': [f'{b}|{a}']}
    assert first not in get_closed_door_edges(g3)


def test_count_game_spaces_no_map_returns_infinity():
    assert math.isinf(count_game_spaces({}, 'a1', 'a2'))


def test_count_game_spaces_real_map():
    g = {'selectedMap': {'id': 'mos-eisley-outskirts'}, 'openedDoors': []}
    d = count_game_spaces(g, 'a1', 'a1')
    assert d == 0  # same cell


def main():
    cases = [
        ('get_all_figure_coords', test_get_all_figure_coords_collects_both_players_lowercase),
        ('count_spaces_same_cell_zero', test_count_spaces_same_cell_zero),
        ('count_spaces_simple_chain', test_count_spaces_simple_chain),
        ('count_spaces_unreachable_infinity', test_count_spaces_unreachable_returns_infinity),
        ('count_spaces_blocked_edge', test_count_spaces_blocked_edge_detours_or_blocks),
        ('is_within_spaces_basic', test_is_within_spaces_basic),
        ('get_closed_door_edges_no_map', test_get_closed_door_edges_no_map_returns_empty),
        ('get_closed_door_edges_real_map', test_get_closed_door_edges_real_map),
        ('get_closed_door_edges_respects_opened', test_get_closed_door_edges_respects_opened),
        ('count_game_spaces_no_map_infinity', test_count_game_spaces_no_map_returns_infinity),
        ('count_game_spaces_real_map', test_count_game_spaces_real_map),
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
