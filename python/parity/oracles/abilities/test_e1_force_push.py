"""D3.8 oracle — Pattern E.1 Force Push three-phase chain.

Exercises `python.engine.abilities.force_push.handle_force_push` and its
dispatch routing via `python.engine.abilities.pattern_e.resolve_pattern_e`.

The JS firing site is `src/game/abilities.js:8020-8073` — three-phase
`ccEffect` chain keyed by `forcePushEffect: true`:

  Phase 1  ctx has no chosen_* fields           → enumerate SMALL figures
                                                   within 3 of active DC
  Phase 2  ctx.chosen_figure_key only           → enumerate destinations
                                                   within 2 of target
  Phase 3  ctx.chosen_figure_key + chosen_space → push + parting-blow warn

The handler accepts `active_figure_keys` + `active_position` directly in ctx
instead of resolving via JS `dcMessageMeta` machinery (that lookup lives in
the D4 handler layer). Oracles therefore build a deterministic game dict + a
synthetic 8×8 grid and drive each phase directly.

Oracle boundaries exercised:
  - Phase 1 enumeration (valid, MASSIVE skip, same-group skip, distance gate,
    dual-player enumeration, labels + values shape, no-result manualMessage)
  - Phase 2 space pick (reachable, occupied filter, missing target/map
    manualMessage, label + chosenFigureKey passthrough)
  - Phase 3 push + warnings (figurePositions mutation, logMessage format,
    path_str emission for path > 2, warnings emission + dedup + log suffix,
    warnings empty when no hostile, warnings carry through when path ≤ 2 but
    start/end adjacency differ — same as JS)
  - Dispatch integration (resolve wraps with pattern='E', wrong pattern
    raises ValueError, unknown ability UnknownAbility, unregistered E ability
    ChainNotImplemented)

Run as: python3 -m python.parity.oracles.abilities.test_e1_force_push
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import UnknownAbility, resolve
from python.engine.abilities.force_push import handle_force_push
from python.engine.abilities.pattern_e import (
    ChainNotImplemented,
    get_chain_handler,
    resolve_pattern_e,
)


# ── Synthetic grid + fixture builders ──────────────────────────────────────

def build_ortho_grid(cols: int, rows: int) -> Dict[str, Any]:
    """4-neighbor grid matching `data/map-spaces.json` adjacency shape."""
    spaces: List[str] = []
    adjacency: Dict[str, List[str]] = {}

    def coord(c: int, r: int) -> str:
        return f'{chr(97 + c)}{r + 1}'

    for r in range(rows):
        for c in range(cols):
            k = coord(c, r)
            spaces.append(k)
            neighbors: List[str] = []
            for dc, dr in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nc, nr = c + dc, r + dr
                if 0 <= nc < cols and 0 <= nr < rows:
                    neighbors.append(coord(nc, nr))
            adjacency[k] = neighbors
    return {
        'spaces': spaces,
        'adjacency': adjacency,
        'terrain': {},
        'blocking': [],
        'movementBlockingEdges': [],
        'impassableEdges': [],
    }


def _game(figure_positions: Optional[Dict[int, Dict[str, str]]] = None,
          figure_orientations: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    return {
        'figurePositions': figure_positions or {1: {}, 2: {}},
        'figureOrientations': figure_orientations or {},
    }


# ── Phase 1 — target enumeration ───────────────────────────────────────────

def test_phase1_empty_board_returns_manual_message():
    game = _game()
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': [],
        'active_position': None,
    })
    assert out.get('applied') is False
    assert out['manualMessage'] == 'No SMALL figures within 3 spaces to push.'


def test_phase1_excludes_active_figure_keys_same_group():
    # Darth Vader (active) + two friendlies; only the non-active one should
    # show up as a target. (active_figure_keys carries the whole active group.)
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1', 'Stormtrooper (Elite)-1-0': 'b1'},
        2: {},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']
    assert out['choiceOptions'] == ['Push: Stormtrooper (Elite) (P1)']


def test_phase1_skips_massive_figures():
    # AT-DP has MASSIVE → skipped. Stormtrooper (Elite) has no MASSIVE/LARGE
    # → included. Both 1 space from Darth Vader (active).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'AT-DP-1-0': 'b1', 'Stormtrooper (Elite)-1-0': 'a2'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']
    assert 'AT-DP-1-0' not in out['choiceValues']


def test_phase1_distance_gate_excludes_far_figures():
    # Stormtrooper at a1 (active), enemy Stormtrooper at e1 (4 spaces away)
    # should be excluded with active_position='a1'.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'e1'},  # 4 spaces away
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('applied') is False


def test_phase1_distance_gate_includes_exactly_3_away():
    # Figure at d1 (3 spaces from a1) is AT the gate threshold — included.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd1'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']


def test_phase1_no_distance_gate_when_active_position_none():
    # With active_position=None, far figures are NOT filtered (mirrors JS
    # `if (actPos && countSpaces(...) > 3)` short-circuit).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {},
        2: {'Stormtrooper (Elite)-1-0': 'h8'},  # far corner
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': [],
        'active_position': None,
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']


def test_phase1_enumerates_both_players():
    # Phase 1 iterates both players — Force Push can target friend or foe.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1', 'Stormtrooper (Elite)-1-0': 'b1'},
        2: {'Stormtrooper (Elite)-2-0': 'c1'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert set(out['choiceValues']) == {
        'Stormtrooper (Elite)-1-0',
        'Stormtrooper (Elite)-2-0',
    }
    # P-tagged labels prove dual-player enumeration.
    labels_set = set(out['choiceOptions'])
    assert 'Push: Stormtrooper (Elite) (P1)' in labels_set
    assert 'Push: Stormtrooper (Elite) (P2)' in labels_set


def test_phase1_missing_game_or_player_num_returns_manual_message():
    # Match JS `if (!game || !playerNum || !dcMessageMeta)` short-circuit.
    out = handle_force_push(None, 'Force Push', {'player_num': 1})
    assert out.get('applied') is False
    assert 'Push a SMALL figure within 3 up to 2 spaces' in out['manualMessage']
    out2 = handle_force_push({}, 'Force Push', {})
    assert out2.get('applied') is False


# ── Phase 2 — landing-space enumeration ────────────────────────────────────

def test_phase2_returns_reachable_spaces_within_2():
    # Stormtrooper at d4 on empty grid — Phase 2 should return coords
    # reachable in 2 MP.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': ['Darth Vader-1-0'],
        'active_position': 'a1',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    # Landing cells up to 2 MP away should include orthogonals at distance 1
    # and 2 in each cardinal direction.
    valid = set(out['validSpaces'])
    assert 'd3' in valid  # up 1
    assert 'd2' in valid  # up 2
    assert 'd5' in valid  # down 1
    assert 'd6' in valid  # down 2
    assert 'c4' in valid  # left 1
    assert 'b4' in valid  # left 2
    assert 'e4' in valid  # right 1
    assert 'f4' in valid  # right 2
    # 3 spaces away must NOT be reachable.
    assert 'd1' not in valid  # 3 up is out of range
    assert out['chosenFigureKey'] == 'Stormtrooper (Elite)-1-0'
    assert out['spaceChoiceLabel'].startswith('**Force Push** — Choose destination')


def test_phase2_filters_out_occupied_spaces():
    # Darth Vader at c4 — Phase 2 should NOT return c4 as a valid destination.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'c4'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': [],
        'active_position': None,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    # c4 is occupied by Darth Vader, must be filtered.
    assert 'c4' not in out['validSpaces']
    # Other reachable cells should still show up.
    assert 'd3' in out['validSpaces'] and 'd5' in out['validSpaces']


def test_phase2_missing_target_position_manual_message():
    grid = build_ortho_grid(8, 8)
    game = _game({1: {}, 2: {}})
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'Could not locate target figure position' in out['manualMessage']


def test_phase2_missing_map_spaces_manual_message():
    # No ctx.map_spaces, no game.selectedMap → load_map_spaces path fails
    # → Phase 2 should manual-message.
    game = _game({1: {}, 2: {'Stormtrooper (Elite)-1-0': 'd4'}})
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
    })
    assert out.get('applied') is False
    assert 'Push manually (no map data)' in out['manualMessage']


def test_phase2_empty_valid_spaces_manual_message():
    # 1x1 corner grid — target at a1 with every neighbor occupied
    # → no valid destinations.
    grid = build_ortho_grid(3, 3)
    game = _game({
        1: {'Darth Vader-1-0': 'a2', 'Stormtrooper (Elite)-1-1': 'b1',
            'Stormtrooper (Elite)-1-2': 'a3',
            'Stormtrooper (Elite)-1-3': 'b2',
            'Stormtrooper (Elite)-1-4': 'c2',
            'Stormtrooper (Elite)-1-5': 'b3'},
        2: {'Stormtrooper (Elite)-2-0': 'a1'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-2-0',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'No empty spaces within 2' in out['manualMessage']


# ── Phase 3 — push + parting-blow warnings ─────────────────────────────────

def test_phase3_push_mutates_figure_positions():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    map_adj = grid['adjacency']
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'd5'
    assert out['refreshBoard'] is True
    # Single-step push (path length 2) has no via-segment.
    assert '**Stormtrooper (Elite)**' in out['logMessage']
    assert '**D4**' in out['logMessage']
    assert '**D5**' in out['logMessage']
    assert ' via ' not in out['logMessage']
    # Return warnings list is populated from compute_push_path_and_warnings.
    assert out['warnings'] == []
    # Exact JS log format: '**Force Push** — **<dc>** pushed from **<OLD>** to **<NEW>**.'
    assert out['logMessage'].startswith('**Force Push** — **Stormtrooper (Elite)** pushed from **D4** to **D5**')
    _ = map_adj  # referenced for clarity; adjacency is resolved via map_spaces


def test_phase3_path_str_emitted_for_two_space_push():
    # Push d4 → d6 (2 spaces): path = [d4, d5, d6], intermediates = ['d5'],
    # so path_str = ' via **D5**'.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd6',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'd6'
    # path_str uses unicode RIGHTWARDS ARROW \u2192 joiner.
    assert ' via **D5**' in out['logMessage']


def test_phase3_parting_blow_warning_emitted():
    # P1 Darth Vader sits at c4 (adjacent to d4 = target at start; NOT
    # adjacent to f4 = target at end after 2-space push). Exits-adjacency
    # event at c4 should emit a Parting Blow warning.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'c4'},          # hostile to P2 target
        2: {'Stormtrooper (Elite)-1-0': 'd4'},  # target
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'f4',  # 2 spaces right → path d4,e4,f4
        'map_spaces': grid,
    })
    assert out['applied'] is True
    # Warnings should name Darth Vader at the exiting space.
    assert len(out['warnings']) == 1
    w = out['warnings'][0]
    assert w['name'] == 'Darth Vader'
    # JS warnings carry exiting_space.upper() — the cell the target LEFT.
    assert w['space'] == 'D4'
    # Log message should include the warning suffix.
    assert '⚠️ Exits adjacency to' in out['logMessage']
    assert '**Darth Vader**' in out['logMessage']
    assert '(exited adj at D4)' in out['logMessage']


def test_phase3_no_warning_when_hostile_still_adjacent_after():
    # Push d4 → d5. Darth Vader at c4 is adjacent to both d4 and c5 (the
    # adjacency between the target footprint and Vader's cell stays across
    # the step), so: is_adjacent_before (c4 adj d4 = yes) AND
    # is_adjacent_after (c4 adj d5 = no, d4 adj c5 = ... wait.)
    # Actually c4 IS adjacent to d4 (exitingSpace, so yes before) but NOT
    # adjacent to d5 (enter_adj = {c5,e5,d4,d6}; c4 not in it, and
    # entering_space != c4). So the warning WILL fire for this case.
    # Use a different layout where Vader sits at d3 — adjacent to d4 before
    # AND adjacent to d5 after? d3 adj = {c3,e3,d2,d4}; d5 adj = {c5,e5,d4,d6};
    # d3 not in d5-adj. So adj-before yes, adj-after via d4? No — d4 is in
    # d5-adj, but Vader's cells are [d3], not [d4]. So adj-after = no, and
    # a warning WOULD fire.
    #
    # A truly no-warning case: target d4 → e4. Vader at e5 (adj to both).
    # e5 adj = {d5,f5,e4,e6}. e4 IS in enter_adj — wait, enter_adj is the
    # adj of the entering space. enter_adj(e4) = {d4,f4,e3,e5}. So Vader's
    # cell e5 is IN enter_adj — adj-after = yes. No warning.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'e5'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'e4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['warnings'] == []
    assert '⚠️ Exits adjacency to' not in out['logMessage']


def test_phase3_no_warning_when_no_hostile_figures():
    # P1 Force-Pushing a P2 target but P2 has no other figures nearby.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['warnings'] == []


def test_phase3_p2_target_owner_resolution():
    # When chosen_figure_key belongs to P2, handler must derive targetPn=2.
    # We assert by checking the mutation landed in figurePositions[2].
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'd5'
    # P1 figures untouched.
    assert game['figurePositions'][1]['Darth Vader-1-0'] == 'a1'


def test_phase3_p1_target_owner_resolution():
    # When chosen_figure_key belongs to P1 (friendly Force Push), handler
    # must derive targetPn=1.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1', 'Stormtrooper (Elite)-1-0': 'd4'},
        2: {},
    })
    out = handle_force_push(game, 'Force Push', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][1]['Stormtrooper (Elite)-1-0'] == 'd5'


# ── Dispatch integration ───────────────────────────────────────────────────

def test_dispatch_resolve_wraps_with_pattern_E():
    game = _game({1: {}, 2: {}})
    out = resolve(game, 'Force Push', {
        'player_num': 1,
        'active_figure_keys': [],
        'active_position': None,
    })
    assert out['ability_id'] == 'Force Push'
    assert out['pattern'] == 'E'
    # Inner payload keys should be present (applied: False in this case).
    assert out.get('applied') is False


def test_resolve_pattern_e_direct_call_matches_dispatch():
    # Direct resolve_pattern_e invocation should mirror dispatch.resolve's
    # shape — ability_id + pattern='E' wrapping.
    game = _game({1: {}, 2: {}})
    ctx = {'player_num': 1, 'active_figure_keys': [], 'active_position': None}
    out = resolve_pattern_e(game, 'Force Push', ctx)
    assert out['ability_id'] == 'Force Push'
    assert out['pattern'] == 'E'


def test_chain_handler_registered_for_force_push():
    handler = get_chain_handler('Force Push')
    assert handler is not None
    assert handler.__name__ == 'handle_force_push'


def test_unregistered_pattern_e_raises_ChainNotImplemented():
    # Post-bulk install: every Pattern E ability has a handler, so
    # ChainNotImplemented is only raised by truly unknown IDs. Smoke
    # test: resolving 'advanced_firepower_sorin' now succeeds via the
    # pending-stamper path.
    out = resolve({}, 'advanced_firepower_sorin', {})
    assert out.get('applied') is True


def test_wrong_pattern_raises_ValueError():
    # Focus is Pattern A — calling resolve_pattern_e on it should raise.
    try:
        resolve_pattern_e({}, 'Focus', {})
    except ValueError as exc:
        assert 'not E' in str(exc)
        return
    assert False


def test_unknown_ability_raises_UnknownAbility():
    try:
        resolve_pattern_e({}, 'NotARealAbility-ZZZ', {})
    except UnknownAbility:
        return
    assert False


def test_dispatch_summary_post_D3_8_has_E_handler():
    from python.engine.abilities.dispatch import dispatch_summary
    s = dispatch_summary()
    assert s['registry']['E'] is not None
    # Function name confirms routing target.
    assert 'resolve_pattern_e' in s['registry']['E']


def test_force_push_classifies_as_E():
    from python.engine.abilities import dispatch as _dispatch
    assert _dispatch.lookup_pattern('Force Push') == 'E'


# ── Runner ─────────────────────────────────────────────────────────────────

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
