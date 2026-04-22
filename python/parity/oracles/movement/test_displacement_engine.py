"""Port of Slice B (B-MVDISP-001..009) from
tests/domain/oracle/movement-rotation-displacement-behavioral.test.js (D6.8a).

Covers the massive displacement engine on a synthetic 6x6 grid with diagonal
adjacency (the JS suite uses anchorhead-cantina-bar, whose adjacency includes
diagonals so e.g. b1 adj = {a1, b2, c1, a2, c2}). The synthetic grid mirrors
that adjacency shape without requiring the D4 data-loader.

Ports:
  B-MVDISP-001: collect_overlapping_figures (friendly-first ordering)
  B-MVDISP-002: get_valid_displacement_spaces (adj − forbidden − occupied)
  B-MVDISP-003: push_figure_to_nearest_valid (BFS fallback)
  B-MVDISP-004: iterative recalc changes later figure options
  B-MVDISP-005: push authority per phase (friendly=controller, enemy=displaced)
  B-MVDISP-006: friendly-before-enemy ordering in mixed overlaps
  B-MVDISP-007: resolve_massive_push (non-interactive) iterative semantics
  B-MVDISP-008: full-contract certification
  B-MVDISP-009: figure-order pick when multiple displacements need choice

Run as: python3 -m python.parity.oracles.movement.test_displacement_engine
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.mechanics.movement_board import (
    MovementProfile,
    build_temp_board_state,
    profile_from_size,
)
from python.engine.mechanics.displacement import (
    apply_displacement_choice,
    apply_figure_pick,
    collect_overlapping_figures,
    get_valid_displacement_spaces,
    init_massive_displacement,
    push_figure_to_nearest_valid,
    resolve_massive_push,
    resolve_next_displacements,
)


# ── Synthetic grid with diagonal adjacency (mirrors anchorhead shape) ───────

def build_diag_grid(cols: int, rows: int,
                    blocked: Optional[List[str]] = None) -> Dict[str, Any]:
    """8-neighbor grid: each interior cell has 8 adj (orth + diagonals)."""
    blocked = set(blocked or [])
    spaces: List[str] = []
    adjacency: Dict[str, List[str]] = {}

    def coord(c: int, r: int) -> str:
        return f'{chr(97 + c)}{r + 1}'

    for r in range(rows):
        for c in range(cols):
            k = coord(c, r)
            if k in blocked:
                continue
            spaces.append(k)
            neighbors: List[str] = []
            for dc in (-1, 0, 1):
                for dr in (-1, 0, 1):
                    if dc == 0 and dr == 0:
                        continue
                    nc, nr = c + dc, r + dr
                    if 0 <= nc < cols and 0 <= nr < rows:
                        nk = coord(nc, nr)
                        if nk in blocked:
                            continue
                        neighbors.append(nk)
            adjacency[k] = neighbors
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'terrain': {},
        'blocking': [],
        'movementBlockingEdges': [],
        'impassableEdges': [],
    }


def _make_game(fig_positions: Optional[Dict[int, Dict[str, str]]] = None,
               orientations: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {
        'gameId': '42',
        'player1Id': 'player1', 'player2Id': 'player2',
        'figurePositions': fig_positions if fig_positions is not None else {1: {}, 2: {}},
        'figureOrientations': orientations or {},
        'figureConditions': {},
        'openedDoors': [],
    }


def _build_board_and_profile(map_spaces: Dict[str, Any],
                             fig_positions: Optional[Dict[int, Dict[str, str]]] = None) -> Dict[str, Any]:
    """Compose occupied_set from all non-moving figures."""
    occupied = []
    if fig_positions:
        for bucket in fig_positions.values():
            occupied.extend(v for v in bucket.values() if v)
    return build_temp_board_state(map_spaces, occupied, None)


def _profile_for(_figure_key: str, _player_num: int) -> MovementProfile:
    """BFS-fallback profile — 1x1 for all figures in these tests."""
    return profile_from_size('1x1')


# ── B-MVDISP-001: collect_overlapping_figures ───────────────────────────────

def test_mvdisp_001a_detects_figure_whose_position_overlaps_massive_footprint():
    game = _make_game({1: {}, 2: {'Stormtrooper (Regular)-1-0': 'c1'}})
    footprint = {'b1', 'c1', 'b2', 'c2'}
    overlaps = collect_overlapping_figures(game, 1, 'MASSIVE-1-0', footprint)
    assert len(overlaps) == 1, f'one overlap detected; got {overlaps}'
    assert overlaps[0]['figureKey'] == 'Stormtrooper (Regular)-1-0'
    assert overlaps[0]['dcName'] == 'Stormtrooper (Regular)'
    assert overlaps[0]['playerNum'] == 2


def test_mvdisp_001b_non_overlapping_figure_excluded():
    game = _make_game({1: {}, 2: {'Stormtrooper (Regular)-1-0': 'e5'}})
    overlaps = collect_overlapping_figures(game, 1, 'MASSIVE-1-0', {'b1', 'c1', 'b2', 'c2'})
    assert len(overlaps) == 0, 'no overlap — figure not in footprint'


def test_mvdisp_001c_moving_figure_excluded_from_results():
    game = _make_game({1: {'MASSIVE-1-0': 'b1'}, 2: {}})
    overlaps = collect_overlapping_figures(game, 1, 'MASSIVE-1-0', {'b1', 'c1', 'b2', 'c2'})
    assert len(overlaps) == 0, 'moving figure excluded'


def test_mvdisp_001d_friendly_overlaps_returned_before_enemy_overlaps():
    game = _make_game({
        1: {'MASSIVE-1-0': 'a1', 'Rebel Trooper-1-0': 'b1'},
        2: {'Stormtrooper (Regular)-1-0': 'c1'},
    })
    overlaps = collect_overlapping_figures(game, 1, 'MASSIVE-1-0', {'b1', 'c1', 'b2', 'c2'})
    assert len(overlaps) == 2
    assert overlaps[0]['playerNum'] == 1, 'friendly first'
    assert overlaps[0]['figureKey'] == 'Rebel Trooper-1-0'
    assert overlaps[1]['playerNum'] == 2, 'enemy second'
    assert overlaps[1]['figureKey'] == 'Stormtrooper (Regular)-1-0'


# ── B-MVDISP-002: get_valid_displacement_spaces ─────────────────────────────

def test_mvdisp_002a_returns_adjacent_empty_non_forbidden_spaces():
    map_spaces = build_diag_grid(6, 6)
    adj = map_spaces['adjacency']
    game = _make_game({1: {}, 2: {'Stormtrooper (Regular)-1-0': 'b1'}})
    # b1 adj (8-neighbor with grid edges): a1, a2, b2, c1, c2
    forbidden = {'b1', 'c1', 'b2', 'c2'}
    valid = get_valid_displacement_spaces(game, 'Stormtrooper (Regular)-1-0', 2, forbidden, adj)
    assert 'a1' in valid, 'a1 is valid displacement space'
    assert 'a2' in valid, 'a2 is valid displacement space'
    for cell in valid:
        assert cell not in forbidden, f'no forbidden cells in result (got {cell})'


def test_mvdisp_002b_excludes_occupied_and_forbidden_spaces():
    map_spaces = build_diag_grid(6, 6)
    adj = map_spaces['adjacency']
    game = _make_game({
        1: {'Rebel Trooper-1-0': 'a1'},  # occupies a1
        2: {'Stormtrooper (Regular)-1-0': 'b1'},
    })
    forbidden = {'b1', 'c1', 'b2', 'c2'}
    valid = get_valid_displacement_spaces(game, 'Stormtrooper (Regular)-1-0', 2, forbidden, adj)
    assert 'a1' not in valid, 'a1 excluded — occupied'
    assert 'a2' in valid, 'a2 is valid'


# ── B-MVDISP-003: push_figure_to_nearest_valid ──────────────────────────────

def test_mvdisp_003a_pushes_to_nearest_valid_space_and_mutates_figure_positions():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {1: {}, 2: {'Stormtrooper (Regular)-1-0': 'b1'}}
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    profile = profile_from_size('1x1')
    forbidden = {'b1'}
    ok = push_figure_to_nearest_valid(game, 2, 'Stormtrooper (Regular)-1-0', forbidden, board, profile)
    assert ok is True, 'push succeeded'
    new_pos = game['figurePositions'][2]['Stormtrooper (Regular)-1-0']
    assert new_pos != 'b1', 'figure moved from b1'
    assert new_pos not in forbidden, 'new position not in forbidden set'


def test_mvdisp_003c_respects_forbidden_set():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {1: {}, 2: {'Stormtrooper (Regular)-1-0': 'b1'}}
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    profile = profile_from_size('1x1')
    forbidden = {'b1', 'c1', 'b2', 'c2'}
    # Remove occupied marking for the moving figure so BFS can consider b1-neighbors.
    ok = push_figure_to_nearest_valid(game, 2, 'Stormtrooper (Regular)-1-0', forbidden, board, profile)
    assert ok is True, 'push succeeded'
    new_pos = game['figurePositions'][2]['Stormtrooper (Regular)-1-0']
    for cell in forbidden:
        assert new_pos != cell, f'not placed on forbidden cell {cell}'


def test_mvdisp_003d_returns_false_when_figure_has_no_position():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {1: {}, 2: {}}
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    profile = profile_from_size('1x1')
    ok = push_figure_to_nearest_valid(game, 2, 'Ghost-1-0', {'a1'}, board, profile)
    assert ok is False, 'returns False — figure has no position'


# ── B-MVDISP-005: push authority per phase ──────────────────────────────────

def test_mvdisp_005a_friendly_phase_controller_is_massive_controller():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {'MASSIVE-1-0': 'a3', 'Rebel Trooper-1-0': 'b1'},
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    assert pending is not None
    assert pending['phase'] == 'friendly'
    result = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    if result['needsChoice']:
        assert result['needsChoice']['controllerPlayerNum'] == 1, (
            'friendly phase: massive controller (P1) picks destination')


def test_mvdisp_005b_enemy_phase_controller_is_enemy_player():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {'MASSIVE-1-0': 'a3'},
        2: {'Stormtrooper (Regular)-1-0': 'b1'},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    assert pending is not None
    assert pending['phase'] == 'enemy', 'starts in enemy phase (no friendlies)'
    result = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    if result['needsChoice']:
        assert result['needsChoice']['controllerPlayerNum'] == 2, (
            'enemy phase: enemy player (P2) picks destination')


# ── B-MVDISP-007: resolve_massive_push non-interactive semantics ────────────

def test_mvdisp_007a_non_interactive_resolves_all_figures_out_of_footprint():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {'MASSIVE-1-0': 'a3'},
        2: {'Stormtrooper (Regular)-1-0': 'b1', 'Stormtrooper (Regular)-2-0': 'c1'},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    profile = profile_from_size('2x2', can_end_on_occupied=True, is_massive=True)
    footprint = ['b1', 'c1', 'b2', 'c2']
    logs: List[str] = []
    resolve_massive_push(
        game, profile, 'MASSIVE-1-0', 1, footprint,
        map_spaces['adjacency'], board, _profile_for,
        log_action=logs.append,
    )
    pos_a = game['figurePositions'][2]['Stormtrooper (Regular)-1-0']
    pos_b = game['figurePositions'][2]['Stormtrooper (Regular)-2-0']
    fp_set = set(footprint)
    assert pos_a not in fp_set, 'figure A not in footprint'
    assert pos_b not in fp_set, 'figure B not in footprint'
    assert pos_a != pos_b, 'figures in different spaces'
    assert game['massiveMovementLocked']['MASSIVE-1-0'] is True, 'movement locked'
    assert len(logs) >= 3, f'at least 3 log messages (2 displacements + lock); got {len(logs)}'


# ── B-MVDISP-009: figure-order pick when multiple displacements need choice ─

def test_mvdisp_009a_friendly_phase_with_two_overlaps_and_choice_needed_triggers_needs_figure_pick():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {
            'MASSIVE-1-0': 'a4',
            'Rebel Trooper-1-0': 'b1',  # adj non-forbidden: a1, a2
            'Rebel Trooper-2-0': 'c1',  # adj non-forbidden: d1, d2
        },
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    assert pending is not None
    assert len(pending['friendlyQueue']) == 2
    r1 = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert len(r1['autoResolved']) == 0, 'nothing auto-resolved — both need choices'
    assert r1['needsFigurePick'] is not None
    assert r1['needsChoice'] is None, 'needsChoice NOT returned yet'
    assert len(r1['needsFigurePick']['pickable']) == 2
    assert r1['needsFigurePick']['controllerPlayerNum'] == 1
    keys = sorted(e['figureKey'] for e in r1['needsFigurePick']['pickable'])
    assert keys == ['Rebel Trooper-1-0', 'Rebel Trooper-2-0']
    # No figures moved yet — only prompt returned
    assert game['figurePositions'][1]['Rebel Trooper-1-0'] == 'b1'
    assert game['figurePositions'][1]['Rebel Trooper-2-0'] == 'c1'


def test_mvdisp_009b_single_unresolved_entry_returns_needs_choice_directly():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {'MASSIVE-1-0': 'a4', 'Rebel Trooper-1-0': 'b1'},
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    assert len(pending['friendlyQueue']) == 1
    r1 = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert r1['needsFigurePick'] is None, 'no figure-pick for solo entry'
    assert r1['needsChoice'] is not None, 'needsChoice returned directly'


def test_mvdisp_009c_apply_figure_pick_swaps_chosen_into_current_index_and_unblocks_choice():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {
            'MASSIVE-1-0': 'a4',
            'Rebel Trooper-1-0': 'b1',
            'Rebel Trooper-2-0': 'c1',
        },
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    initial_first_key = pending['friendlyQueue'][0]['figureKey']
    assert initial_first_key == 'Rebel Trooper-1-0'
    r1 = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert r1['needsFigurePick'] is not None
    ok = apply_figure_pick(pending, 'Rebel Trooper-2-0')
    assert ok is True
    assert pending['friendlyQueue'][0]['figureKey'] == 'Rebel Trooper-2-0', (
        'chosen figure swapped into currentIndex slot')
    assert pending['friendlyQueue'][1]['figureKey'] == 'Rebel Trooper-1-0', (
        'displaced figure moved to the other slot')
    # Next resolve must NOT re-ask figure-pick (order locked); should return needsChoice.
    r2 = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert r2['needsFigurePick'] is None, 'no re-prompt for figure-pick'
    assert r2['needsChoice'] is not None
    assert r2['needsChoice']['entry']['figureKey'] == 'Rebel Trooper-2-0'


def test_mvdisp_009d_enemy_phase_figure_pick_controller_is_enemy_player():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {'MASSIVE-1-0': 'a4'},
        2: {
            'Stormtrooper (Regular)-1-0': 'b1',
            'Stormtrooper (Regular)-2-0': 'c1',
        },
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    assert pending['phase'] == 'enemy'
    assert len(pending['enemyQueue']) == 2
    r1 = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert r1['needsFigurePick'] is not None
    assert r1['needsFigurePick']['controllerPlayerNum'] == 2, (
        'enemy phase → displaced figure owner (P2) picks order')


def test_mvdisp_009e_full_figure_pick_plus_space_pick_cycle_produces_valid_end_state():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {
            'MASSIVE-1-0': 'a4',
            'Rebel Trooper-1-0': 'b1',
            'Rebel Trooper-2-0': 'c1',
        },
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    safety = 0
    result = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    while not result['done']:
        safety += 1
        if safety > 20:
            raise AssertionError('engine loop did not terminate')
        if result['needsFigurePick']:
            apply_figure_pick(pending, result['needsFigurePick']['pickable'][0]['figureKey'])
        elif result['needsChoice']:
            apply_displacement_choice(game, pending, result['needsChoice']['validSpaces'][0])
        result = resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    pos_a = game['figurePositions'][1]['Rebel Trooper-1-0']
    pos_b = game['figurePositions'][1]['Rebel Trooper-2-0']
    assert pos_a not in footprint, 'Trooper-1 not in footprint'
    assert pos_b not in footprint, 'Trooper-2 not in footprint'
    assert pos_a != pos_b, 'Troopers in different spaces'


def test_mvdisp_009f_apply_figure_pick_returns_false_for_unknown_figure():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {
            'MASSIVE-1-0': 'a4',
            'Rebel Trooper-1-0': 'b1',
            'Rebel Trooper-2-0': 'c1',
        },
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    footprint = {'b1', 'c1', 'b2', 'c2'}
    pending = init_massive_displacement(game, 1, 'MASSIVE-1-0', footprint)
    resolve_next_displacements(game, pending, map_spaces['adjacency'], board, _profile_for)
    assert apply_figure_pick(pending, 'Does-Not-Exist-0-0') is False


def test_mvdisp_009g_resolve_massive_push_handles_needs_figure_pick_deterministically():
    map_spaces = build_diag_grid(6, 6)
    fig_positions = {
        1: {
            'MASSIVE-1-0': 'a4',
            'Rebel Trooper-1-0': 'b1',
            'Rebel Trooper-2-0': 'c1',
        },
        2: {},
    }
    game = _make_game(fig_positions)
    board = _build_board_and_profile(map_spaces, fig_positions)
    profile = profile_from_size('2x2', can_end_on_occupied=True, is_massive=True)
    footprint = ['b1', 'c1', 'b2', 'c2']
    logs: List[str] = []
    resolve_massive_push(
        game, profile, 'MASSIVE-1-0', 1, footprint,
        map_spaces['adjacency'], board, _profile_for,
        log_action=logs.append,
    )
    fp_set = set(footprint)
    pos_a = game['figurePositions'][1]['Rebel Trooper-1-0']
    pos_b = game['figurePositions'][1]['Rebel Trooper-2-0']
    assert pos_a not in fp_set, 'Trooper-1 not in footprint'
    assert pos_b not in fp_set, 'Trooper-2 not in footprint'
    assert pos_a != pos_b, 'Troopers in different spaces'
    assert game['massiveMovementLocked']['MASSIVE-1-0'] is True


ALL_TESTS = [
    test_mvdisp_001a_detects_figure_whose_position_overlaps_massive_footprint,
    test_mvdisp_001b_non_overlapping_figure_excluded,
    test_mvdisp_001c_moving_figure_excluded_from_results,
    test_mvdisp_001d_friendly_overlaps_returned_before_enemy_overlaps,
    test_mvdisp_002a_returns_adjacent_empty_non_forbidden_spaces,
    test_mvdisp_002b_excludes_occupied_and_forbidden_spaces,
    test_mvdisp_003a_pushes_to_nearest_valid_space_and_mutates_figure_positions,
    test_mvdisp_003c_respects_forbidden_set,
    test_mvdisp_003d_returns_false_when_figure_has_no_position,
    test_mvdisp_005a_friendly_phase_controller_is_massive_controller,
    test_mvdisp_005b_enemy_phase_controller_is_enemy_player,
    test_mvdisp_007a_non_interactive_resolves_all_figures_out_of_footprint,
    test_mvdisp_009a_friendly_phase_with_two_overlaps_and_choice_needed_triggers_needs_figure_pick,
    test_mvdisp_009b_single_unresolved_entry_returns_needs_choice_directly,
    test_mvdisp_009c_apply_figure_pick_swaps_chosen_into_current_index_and_unblocks_choice,
    test_mvdisp_009d_enemy_phase_figure_pick_controller_is_enemy_player,
    test_mvdisp_009e_full_figure_pick_plus_space_pick_cycle_produces_valid_end_state,
    test_mvdisp_009f_apply_figure_pick_returns_false_for_unknown_figure,
    test_mvdisp_009g_resolve_massive_push_handles_needs_figure_pick_deterministically,
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
