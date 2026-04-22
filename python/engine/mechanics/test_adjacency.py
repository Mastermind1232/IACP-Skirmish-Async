"""Adjacency parity + unit tests (D2.3 verify).

Unit tests cover the three helpers directly. Parity test shells out to
`tests/headless/dump-adjacency-sample.js` to get the JS-side neighbor lists
for 100 random cells across 3 maps, then diffs against the Python loader.

Run as: python3 -m python.engine.mechanics.test_adjacency
"""
import json
import subprocess
import sys
from pathlib import Path

from python.engine.board_data import load_map_spaces
from python.engine.mechanics.adjacency import (
    is_manhattan_adjacent, is_chebyshev_adjacent,
    get_map_neighbors, is_door_adjacent,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
DUMP_SCRIPT = REPO_ROOT / 'tests' / 'headless' / 'dump-adjacency-sample.js'


# ── Unit tests ──────────────────────────────────────────────────────────────

def test_manhattan_adjacency_basic():
    assert is_manhattan_adjacent('a1', 'a2') is True, 'vertical neighbor'
    assert is_manhattan_adjacent('a1', 'b1') is True, 'horizontal neighbor'
    assert is_manhattan_adjacent('a1', 'b2') is False, 'diagonal is not Manhattan-adj'
    assert is_manhattan_adjacent('a1', 'a1') is False, 'same cell is not adjacent'
    assert is_manhattan_adjacent('a1', 'a3') is False, 'distance 2'


def test_manhattan_adjacency_invalid():
    assert is_manhattan_adjacent('', 'a1') is False, 'empty source invalid'
    assert is_manhattan_adjacent('a1', '') is False, 'empty target invalid'
    assert is_manhattan_adjacent(None, 'a1') is False, 'None source invalid'


def test_chebyshev_adjacency_basic():
    assert is_chebyshev_adjacent('a1', 'a2') is True, 'orthogonal is Chebyshev-adj'
    assert is_chebyshev_adjacent('a1', 'b1') is True, 'orthogonal is Chebyshev-adj'
    assert is_chebyshev_adjacent('a1', 'b2') is True, 'diagonal is Chebyshev-adj'
    assert is_chebyshev_adjacent('a1', 'a1') is False, 'same cell not adjacent'
    assert is_chebyshev_adjacent('a1', 'c3') is False, 'distance 2'


def test_get_map_neighbors_roundtrip():
    """Neighbors returned by helper match raw adjacency dict entries."""
    m = load_map_spaces('mos-eisley-outskirts')
    sample = list(m['adjacency'].keys())[:5]
    for coord in sample:
        want = list(m['adjacency'][coord])
        got = get_map_neighbors(m, coord)
        assert set(got) == set(want), f'{coord}: mismatch got={got} want={want}'


def test_get_map_neighbors_unknown_cell():
    m = load_map_spaces('mos-eisley-outskirts')
    assert get_map_neighbors(m, 'zz999') == [], 'unknown cell -> empty list'


def test_get_map_neighbors_returns_fresh_list():
    m = load_map_spaces('mos-eisley-outskirts')
    coord = next(iter(m['adjacency']))
    n1 = get_map_neighbors(m, coord)
    n1.append('garbage')
    n2 = get_map_neighbors(m, coord)
    assert 'garbage' not in n2, 'neighbors list was shared across calls'


def test_door_adjacency_edge_sharing_only():
    # Standard 2-cell door at c5|c6. Figure 1x1 standing on c4 shares an edge
    # with c5 — must qualify. Standing on b4 is diagonal to c5 and must NOT.
    door_cells = ['c5', 'c6']
    assert is_door_adjacent(['c4'], door_cells) is True, 'c4 edge-shares with c5'
    assert is_door_adjacent(['d5'], door_cells) is True, 'd5 edge-shares with c5'
    assert is_door_adjacent(['b4'], door_cells) is False, 'b4 is diagonal to c5 — not adjacent'
    assert is_door_adjacent(['d6'], door_cells) is True, 'd6 edge-shares with c6'
    assert is_door_adjacent(['e7'], door_cells) is False, 'e7 is diagonal to c6'


def test_door_adjacency_on_door_cell():
    # Figure on the door cell itself qualifies (distance 0). This matches JS
    # footprint-overlap behavior in getLegalInteractOptions.
    assert is_door_adjacent(['c5'], ['c5', 'c6']) is True, 'figure on door qualifies'


def test_door_adjacency_multi_cell_figure():
    # 2x2 figure at b4 occupies {b4,c4,b5,c5}. c5 is a door cell — qualifies
    # via direct overlap. This is the classic "large figure astride the door"
    # case that motivated the edge-sharing rule.
    figure = ['b4', 'c4', 'b5', 'c5']
    assert is_door_adjacent(figure, ['c5', 'c6']) is True, '2x2 with c5 in footprint'


def test_door_adjacency_empty_inputs():
    assert is_door_adjacent([], ['c5']) is False, 'no figure -> not adjacent'
    assert is_door_adjacent(['c4'], []) is False, 'no door cells -> not adjacent'


# ── Parity test: JS dump vs Python loader ─────────────────────────────────

def test_adjacency_sample_parity_three_maps():
    """JS adjacency sample == Python-loaded adjacency, for 100 random cells
    across 3 maps. Deterministic via --seed 1 and sorted output on both sides.
    """
    # Pick three maps of varied size / topology
    target_maps = ['mos-eisley-outskirts', 'lothal-wastes', 'devaron-garrison']
    proc = subprocess.run(
        ['node', str(DUMP_SCRIPT),
         '--count', '100', '--maps', ','.join(target_maps), '--seed', '1'],
        capture_output=True, text=True, cwd=str(REPO_ROOT), timeout=30,
    )
    if proc.returncode != 0:
        raise AssertionError(
            f'dump-adjacency-sample.js failed ({proc.returncode}):\n'
            f'STDOUT={proc.stdout}\nSTDERR={proc.stderr}')
    js_data = json.loads(proc.stdout)
    failures = []
    total_cells = 0
    for mid in target_maps:
        assert mid in js_data, f'JS dump missing map {mid}'
        m = load_map_spaces(mid)
        js_entries = js_data[mid]
        for coord, js_neighbors in js_entries.items():
            total_cells += 1
            py_neighbors = sorted(get_map_neighbors(m, coord))
            js_sorted = sorted(js_neighbors)
            if py_neighbors != js_sorted:
                failures.append(
                    f'{mid} @ {coord}: py={py_neighbors} js={js_sorted}')
    assert not failures, (
        f'Adjacency parity failures ({len(failures)}):\n  '
        + '\n  '.join(failures[:10]))
    assert total_cells == 300, f'Expected 300 cells (100×3), got {total_cells}'


ALL_TESTS = [
    test_manhattan_adjacency_basic,
    test_manhattan_adjacency_invalid,
    test_chebyshev_adjacency_basic,
    test_get_map_neighbors_roundtrip,
    test_get_map_neighbors_unknown_cell,
    test_get_map_neighbors_returns_fresh_list,
    test_door_adjacency_edge_sharing_only,
    test_door_adjacency_on_door_cell,
    test_door_adjacency_multi_cell_figure,
    test_door_adjacency_empty_inputs,
    test_adjacency_sample_parity_three_maps,
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
