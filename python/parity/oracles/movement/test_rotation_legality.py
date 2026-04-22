"""Port of Slice A (B-MVROT-001..004) from
tests/domain/oracle/movement-rotation-displacement-behavioral.test.js (D6.8a).

Covers rotation legality for non-square large figures (1x2 ↔ 2x1):
  B-MVROT-001: rotation in place — single endpoint at same topLeft, size flipped
  B-MVROT-002: rotation blocked by occupied / out-of-bounds / blocking-terrain
  B-MVROT-003: rotation + movement coherence (path-only-via-rotate, slide-only)
  B-MVROT-004: geometry integrity — no diagonals, perpendicular-slide blocked,
               square profile never rotates

Run as: python3 -m python.parity.oracles.movement.test_rotation_legality
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.mechanics.movement_board import (
    MovementProfile,
    build_temp_board_state,
    movement_state_key,
)
from python.engine.mechanics.movement_cache import (
    compute_movement_cache,
    get_movement_target,
    get_spaces_at_cost,
)


# ── Synthetic grid builder (mirrors JS buildGrid) ───────────────────────────

def build_grid(cols: int, rows: int,
               blocked: Optional[List[str]] = None,
               difficult: Optional[List[str]] = None,
               movement_blocking_edges: Optional[List[List[str]]] = None) -> Dict[str, Any]:
    """Orthogonal-adjacency grid (no diagonals). Rotation tests use large
    figures, which set `allow_diagonal=False` anyway — diagonal adjacency
    would only confuse the probe."""
    blocked = set(blocked or [])
    difficult = set(difficult or [])
    mbe = movement_blocking_edges or []
    mbe_keys = {'|'.join(sorted([a, b])) for a, b in mbe}
    spaces: List[str] = []
    adjacency: Dict[str, List[str]] = {}
    terrain: Dict[str, str] = {}

    def coord(c: int, r: int) -> str:
        return f'{chr(97 + c)}{r + 1}'

    for r in range(rows):
        for c in range(cols):
            k = coord(c, r)
            if k in blocked:
                continue
            spaces.append(k)
            terrain[k] = 'difficult' if k in difficult else 'normal'
            neighbors: List[str] = []
            for dc, dr in ((0, -1), (0, 1), (-1, 0), (1, 0)):
                nc, nr = c + dc, r + dr
                if 0 <= nc < cols and 0 <= nr < rows:
                    nk = coord(nc, nr)
                    if nk in blocked:
                        continue
                    ek = '|'.join(sorted([k, nk]))
                    if ek in mbe_keys:
                        continue
                    neighbors.append(nk)
            adjacency[k] = neighbors
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'terrain': terrain,
        'blocking': [],
        'movementBlockingEdges': list(mbe),
        'impassableEdges': [],
    }


def _rotatable_profile() -> MovementProfile:
    """1x2 vertical figure, isLarge=True, canRotate=True (cols != rows)."""
    return MovementProfile(
        size='1x2', cols=1, rows=2,
        is_large=True, allow_diagonal=False, can_rotate=True,
    )


def _square_profile() -> MovementProfile:
    """2x2 square, isLarge=True, canRotate=False (cols == rows)."""
    return MovementProfile(
        size='2x2', cols=2, rows=2,
        is_large=True, allow_diagonal=False, can_rotate=False,
    )


# ── B-MVROT-001: legal rotation in place ────────────────────────────────────

def test_mvrot_001a_rotation_produces_endpoint_at_same_top_left_with_rotated_size():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 1, board, _rotatable_profile())
    a1 = get_movement_target(cache, 'a1')
    assert a1 is not None, 'a1 reachable at 1 MP (rotation in place)'
    assert a1['cost'] == 1, 'rotation costs exactly 1 MP'
    assert a1['size'] == '2x1', 'rotated size is 2x1 (was 1x2)'


def test_mvrot_001b_distinct_state_keys_for_each_orientation_in_nodes():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 2, board, _rotatable_profile())
    nodes = cache['nodes']
    assert movement_state_key('a1', '1x2') in nodes, 'a1|1x2 (start orientation) in nodes'
    assert movement_state_key('a1', '2x1') in nodes, 'a1|2x1 (rotated orientation) in nodes'


def test_mvrot_001c_exactly_2_endpoints_at_1_mp_rotation_and_slide_down():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 1, board, _rotatable_profile())
    at1 = get_spaces_at_cost(cache, 1)
    assert 'a1' in at1, 'a1 in 1-MP set (rotation)'
    assert 'a2' in at1, 'a2 in 1-MP set (slide down)'
    assert len(at1) == 2, f'exactly 2 endpoints (perpendicular slide blocked); got {at1}'


# ── B-MVROT-002: rotation blocked by collision ──────────────────────────────

def test_mvrot_002a_occupied_cell_in_rotated_footprint_blocks_rotation():
    map_spaces = build_grid(6, 6)
    # b1 occupied — blocks rotation from 1x2 at a1 to 2x1 (footprint a1, b1)
    board = build_temp_board_state(map_spaces, ['b1'], [])
    cache = compute_movement_cache('a1', 1, board, _rotatable_profile())
    a1 = get_movement_target(cache, 'a1')
    assert a1 is None, 'rotation blocked — b1 occupied in rotated footprint'
    at1 = get_spaces_at_cost(cache, 1)
    assert 'a2' in at1 and len(at1) == 1, 'only slide-down remains'


def test_mvrot_002b_out_of_bounds_cell_in_rotated_footprint_blocks_rotation():
    # 1x2 at e1 on a 5-col grid (a-e). Rotate to 2x1 would need f1 (off grid).
    map_spaces = build_grid(5, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('e1', 1, board, _rotatable_profile())
    e1 = get_movement_target(cache, 'e1')
    assert e1 is None, 'rotation blocked — f1 does not exist on 5-col grid'


def test_mvrot_002c_blocking_terrain_in_rotated_footprint_blocks_rotation():
    map_spaces = build_grid(6, 6)
    map_spaces['blocking'] = ['b1']
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 1, board, _rotatable_profile())
    a1 = get_movement_target(cache, 'a1')
    assert a1 is None, 'rotation blocked — b1 is blocking terrain'


# ── B-MVROT-003: rotation + movement coherence ──────────────────────────────

def test_mvrot_003a_destination_reachable_only_via_rotate_first_path():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 2, board, _rotatable_profile())
    b1 = get_movement_target(cache, 'b1')
    assert b1 is not None, 'b1 reachable at 2 MP (rotate then slide right)'
    assert b1['cost'] == 2
    assert b1['size'] == '2x1', 'arrives in rotated orientation'


def test_mvrot_003b_destination_reachable_only_via_slide_first_path_no_rotation():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 2, board, _rotatable_profile())
    a3 = get_movement_target(cache, 'a3')
    assert a3 is not None, 'a3 reachable at 2 MP (slide down twice)'
    assert a3['cost'] == 2
    assert a3['size'] == '1x2', 'arrives in original orientation'


def test_mvrot_003c_double_rotation_still_has_both_orientation_nodes():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 3, board, _rotatable_profile())
    node_original = cache['nodes'].get(movement_state_key('a1', '1x2'))
    node_rotated = cache['nodes'].get(movement_state_key('a1', '2x1'))
    assert node_original is not None, 'original orientation node exists'
    assert node_rotated is not None, 'rotated orientation node exists'
    assert node_original['cost'] == 0, 'original at cost 0 (start)'
    assert node_rotated['cost'] == 1, 'rotated at cost 1'


# ── B-MVROT-004: geometry integrity ─────────────────────────────────────────

def test_mvrot_004a_no_diagonal_moves_with_canrotate_profile():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('b2', 1, board, _rotatable_profile())
    at1 = get_spaces_at_cost(cache, 1)
    for dest in at1:
        assert dest not in {'a1', 'c1', 'a3', 'c3'}, (
            f'{dest} should not be reachable — no diagonals for large figures')


def test_mvrot_004b_1x2_cannot_slide_perpendicular_to_long_axis():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('b2', 1, board, _rotatable_profile())
    c2 = get_movement_target(cache, 'c2')
    assert c2 is None, 'c2 not reachable at 1 MP — perpendicular slide blocked'
    a2 = get_movement_target(cache, 'a2')
    assert a2 is None, 'a2 not reachable at 1 MP — perpendicular slide blocked'


def test_mvrot_004c_square_2x2_has_canrotate_false_no_rotation_in_cache():
    map_spaces = build_grid(6, 6)
    board = build_temp_board_state(map_spaces, [], [])
    cache = compute_movement_cache('a1', 1, board, _square_profile())
    a1 = get_movement_target(cache, 'a1')
    assert a1 is None, 'a1 not reachable — square figures cannot rotate'
    at1 = get_spaces_at_cost(cache, 1)
    assert len(at1) == 2, f'exactly 2 endpoints (no rotation); got {at1}'


ALL_TESTS = [
    test_mvrot_001a_rotation_produces_endpoint_at_same_top_left_with_rotated_size,
    test_mvrot_001b_distinct_state_keys_for_each_orientation_in_nodes,
    test_mvrot_001c_exactly_2_endpoints_at_1_mp_rotation_and_slide_down,
    test_mvrot_002a_occupied_cell_in_rotated_footprint_blocks_rotation,
    test_mvrot_002b_out_of_bounds_cell_in_rotated_footprint_blocks_rotation,
    test_mvrot_002c_blocking_terrain_in_rotated_footprint_blocks_rotation,
    test_mvrot_003a_destination_reachable_only_via_rotate_first_path,
    test_mvrot_003b_destination_reachable_only_via_slide_first_path_no_rotation,
    test_mvrot_003c_double_rotation_still_has_both_orientation_nodes,
    test_mvrot_004a_no_diagonal_moves_with_canrotate_profile,
    test_mvrot_004b_1x2_cannot_slide_perpendicular_to_long_axis,
    test_mvrot_004c_square_2x2_has_canrotate_false_no_rotation_in_cache,
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
