"""Port of tests/domain/oracle/los-slice2-probes.test.js (D6).

Covers two CRR-required LOS behaviors using `has_line_of_sight` as a pure
function — no game state, no handler plumbing:

  PROBE-LOS-SLICE2-001: closed door (single impassable edge) blocks LOS
  PROBE-LOS-SLICE2-002: no door (empty impassableEdges) does NOT block LOS
  PROBE-LOS-SLICE2-003: 2x2 attacker — at least one footprint cell has LOS
  PROBE-LOS-SLICE2-004: 2x2 target  — at least one footprint cell reachable

Parity with JS: these tests pass in JS via hasLineOfSight; the Python port
must produce the same boolean outcomes on identical map-spaces dicts.

Run as: python3 -m python.parity.oracles.los.test_los_slice2_probes
"""
import sys

from python.engine.mechanics.coords import get_footprint_cells
from python.engine.mechanics.los import has_line_of_sight


# ── PROBE-LOS-SLICE2-001: closed door blocks LOS ────────────────────────────

def test_probe_001_a3_to_a5_across_closed_door_returns_false():
    map_spaces = {'blocking': [], 'impassableEdges': [['a3', 'a4']]}
    los = has_line_of_sight('a3', 'a5', map_spaces, None)
    assert los is False, 'Closed door between a3|a4 must block LOS from a3 to a5.'


def test_probe_001_a3_to_a4_adjacency_across_door_returns_false():
    map_spaces = {'blocking': [], 'impassableEdges': [['a3', 'a4']]}
    los = has_line_of_sight('a3', 'a4', map_spaces, None)
    assert los is False, 'Closed door between a3|a4 must block adjacency LOS a3 → a4.'


# ── PROBE-LOS-SLICE2-002: no door (empty edges) does NOT block LOS ─────────

def test_probe_002_a3_to_a5_with_empty_edges_returns_true():
    map_spaces = {'blocking': [], 'impassableEdges': []}
    los = has_line_of_sight('a3', 'a5', map_spaces, None)
    assert los is True, 'With no impassable edges, a3 → a5 must have LOS.'


def test_probe_002_a3_to_a5_with_unrelated_edge_still_has_los():
    map_spaces = {'blocking': [], 'impassableEdges': [['z20', 'z21']]}
    los = has_line_of_sight('a3', 'a5', map_spaces, None)
    assert los is True, 'Unrelated impassable edge (z20|z21) must not affect LOS a3 → a5.'


# ── PROBE-LOS-SLICE2-003: 2x2 attacker — any footprint cell has LOS ─────────

def test_probe_003_2x2_attacker_all_cells_los_to_open_f3():
    map_spaces = {'blocking': [], 'impassableEdges': []}
    attacker_cells = get_footprint_cells('a3', '2x2')
    assert len(attacker_cells) == 4, f'2x2 footprint must expand to 4 cells. Got: {attacker_cells}'
    any_has_los = any(
        has_line_of_sight(cell, 'f3', map_spaces, None) for cell in attacker_cells)
    assert any_has_los, (
        f'At least one cell of 2x2 attacker at a3 must have LOS to f3. '
        f'Footprint: {attacker_cells}')


def test_probe_003_2x2_attacker_back_cell_los_past_blocker():
    # Blocker at c3 blocks the straight sightline from the front row but
    # back-row cells can see around via corner-to-corner LOS.
    map_spaces = {'blocking': ['c3'], 'impassableEdges': []}
    attacker_cells = get_footprint_cells('a3', '2x2')
    los_per_cell = {c: has_line_of_sight(c, 'f3', map_spaces, None) for c in attacker_cells}
    any_has_los = any(los_per_cell.values())
    assert any_has_los, (
        f'2x2 attacker at a3 must have LOS to f3 from at least one cell with '
        f'blocker at c3. Per-cell LOS: {los_per_cell}')


# ── PROBE-LOS-SLICE2-004: 2x2 target — any cell reachable ───────────────────

def test_probe_004_1x1_attacker_sees_2x2_target_cells():
    map_spaces = {'blocking': [], 'impassableEdges': []}
    target_cells = get_footprint_cells('f3', '2x2')
    assert len(target_cells) == 4, f'2x2 footprint must expand to 4 cells. Got: {target_cells}'
    any_reachable = any(
        has_line_of_sight('a3', cell, map_spaces, None) for cell in target_cells)
    assert any_reachable, (
        f'1x1 attacker at a3 must see at least one cell of 2x2 target at f3. '
        f'Footprint: {target_cells}')


def test_probe_004_blocker_on_f3_still_leaves_back_cells_reachable():
    # Self-exclusion: f3 → a3 is allowed because f3 is one of the target cells
    # being queried; the remaining target cells (g3, f4, g4) are unobstructed.
    map_spaces = {'blocking': ['f3'], 'impassableEdges': []}
    target_cells = get_footprint_cells('f3', '2x2')
    los_per_cell = {c: has_line_of_sight('a3', c, map_spaces, None) for c in target_cells}
    reachable_count = sum(1 for v in los_per_cell.values() if v)
    assert reachable_count >= 1, (
        f'At least one cell of 2x2 target at f3 must be reachable from a3 '
        f'(blocker only on f3). Per-cell LOS: {los_per_cell}')


ALL_TESTS = [
    test_probe_001_a3_to_a5_across_closed_door_returns_false,
    test_probe_001_a3_to_a4_adjacency_across_door_returns_false,
    test_probe_002_a3_to_a5_with_empty_edges_returns_true,
    test_probe_002_a3_to_a5_with_unrelated_edge_still_has_los,
    test_probe_003_2x2_attacker_all_cells_los_to_open_f3,
    test_probe_003_2x2_attacker_back_cell_los_past_blocker,
    test_probe_004_1x1_attacker_sees_2x2_target_cells,
    test_probe_004_blocker_on_f3_still_leaves_back_cells_reachable,
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
