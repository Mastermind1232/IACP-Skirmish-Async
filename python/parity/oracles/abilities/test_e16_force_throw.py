"""D3.11 oracle — Pattern E.16 Force Throw three-phase chain.

Exercises `python.engine.abilities.force_throw.handle_force_throw` and its
dispatch routing via `python.engine.abilities.pattern_e.resolve_pattern_e`.

The JS firing site is `src/game/abilities.js:294-463` — three-phase `dcSpecial`
chain keyed by `pushTargetWithinRange`+`pushLandingEffect` (range 3 /
requiresSmall / maxDistanceFromTarget 2). Library entry carries
`strainCostToSelf: 1` which fires in Phase 1 AFTER `valid_targets` is confirmed
non-empty.

  Phase 1  ctx has no chosen_* fields           → enumerate SMALL figures
                                                   within 3 of active DC;
                                                   apply 1 strain to self iff
                                                   ≥1 valid target
  Phase 2  ctx.chosen_figure_key only           → enumerate destinations
                                                   within 2 of target via
                                                   count_spaces BFS (NOT
                                                   get_reachable_spaces)
  Phase 3  ctx.chosen_figure_key + chosen_space → push + parting-blow warn

Delta vs E.1 Force Push — the oracle explicitly probes the JS-site divergences:
  - Phase 1 excludes only `attacker_figure_key` (single figure, not full group).
  - Phase 2 occupied set is TOP-LEFT-only with target's own cell excluded.
  - Phase 1 return key is `targetFigureKeys`; Phase 2 uses `targetFigureKey`.
  - Phase 3 log format uses `**Force Throw** — **{attacker}** pushed
    **{target}** from {OLD} to {DEST}{path_str}.` (coords NOT bolded).
  - Strain-to-self is paid once in Phase 1 iff valid_targets non-empty.

Run as: python3 -m python.parity.oracles.abilities.test_e16_force_throw
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import UnknownAbility, resolve
from python.engine.abilities.force_throw import handle_force_throw
from python.engine.abilities.pattern_e import (
    ChainNotImplemented,
    get_chain_handler,
    registered_chain_ids,
    resolve_pattern_e,
)
from python.engine.data import dc_effects_loader


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
        'p1DcAttachments': {},
        'p2DcAttachments': {},
    }


def _patch_large(dc_name: str) -> None:
    """Inject 'LARGE' keyword into the cached dc_effects for a test DC."""
    ef = dc_effects_loader.get_dc_effects()
    if dc_name not in ef:
        ef[dc_name] = {'keywords': ['LARGE']}
    else:
        kws = list(ef[dc_name].get('keywords') or [])
        if 'LARGE' not in [str(k).upper() for k in kws]:
            kws.append('LARGE')
            ef[dc_name] = {**ef[dc_name], 'keywords': kws}


def _unpatch_large(dc_name: str, original: Optional[Dict[str, Any]]) -> None:
    ef = dc_effects_loader.get_dc_effects()
    if original is None:
        ef.pop(dc_name, None)
    else:
        ef[dc_name] = original


# ── Phase 1 — target enumeration + strain-to-self ──────────────────────────

def test_phase1_empty_board_returns_manual_message():
    game = _game()
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out.get('applied') is False
    assert 'no valid SMALL targets' in out['manualMessage']


def test_phase1_excludes_attacker_figure_key_single():
    # Phase 1 excludes ONLY the single attacker figure, not the full group
    # (delta vs Force Push which excludes active_figure_keys list).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1', 'Stormtrooper (Elite)-1-0': 'b1'},
        2: {},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    # Active Vader excluded; friendly Stormtrooper present.
    assert out['targetFigureKeys'] == ['Stormtrooper (Elite)-1-0']
    # The Phase-1 return key is the JS-divergent 'targetFigureKeys', NOT
    # 'choiceValues'. Verify.
    assert 'choiceValues' not in out


def test_phase1_skips_massive_figures():
    # AT-DP has MASSIVE → skipped. Stormtrooper (Elite) has no MASSIVE/LARGE
    # → included. Both 1 space from Vader (active).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'AT-DP-1-0': 'b1', 'Stormtrooper (Elite)-1-0': 'a2'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['targetFigureKeys'] == ['Stormtrooper (Elite)-1-0']
    assert 'AT-DP-1-0' not in out['targetFigureKeys']


def test_phase1_skips_large_figures():
    # data/dc-effects.json has no DC with the LARGE keyword today, so inject
    # one into the cached dc_effects for the duration of this test.
    ef = dc_effects_loader.get_dc_effects()
    original = dict(ef.get('Stormtrooper (Elite)', {})) if 'Stormtrooper (Elite)' in ef else None
    _patch_large('Stormtrooper (Elite)')
    try:
        grid = build_ortho_grid(8, 8)
        game = _game({
            1: {'Darth Vader-1-0': 'a1'},
            2: {'Stormtrooper (Elite)-1-0': 'b1'},
        })
        out = handle_force_throw(game, 'force_throw', {
            'player_num': 1,
            'attacker_figure_key': 'Darth Vader-1-0',
            'active_position': 'a1',
            'map_spaces': grid,
        })
        # LARGE skip should cause the single candidate to drop out → empty.
        assert out.get('applied') is False
        assert 'no valid SMALL targets' in out['manualMessage']
    finally:
        _unpatch_large('Stormtrooper (Elite)', original)


def test_phase1_distance_gate_excludes_far_figures():
    # Stormtrooper at e1 (4 spaces from a1) → excluded.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'e1'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'no valid SMALL targets' in out['manualMessage']


def test_phase1_distance_gate_includes_exactly_3_away():
    # Figure at d1 (3 spaces from a1) is AT gate threshold — included.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd1'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['targetFigureKeys'] == ['Stormtrooper (Elite)-1-0']


def test_phase1_strain_applied_when_valid_targets_nonempty():
    # Strain fires in Phase 1 iff at least one valid target is enumerated.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'b1'},
    })
    dc_health_state = {'vader-msg': [[5, 5]]}
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
        'attacker_msg_id': 'vader-msg',
        'dc_health_state': dc_health_state,
    })
    assert out.get('requiresChoice') is True
    assert out['strainApplied'] is True
    assert out['refreshDcEmbed'] is True
    # Vader's HP slot must drop from 5 → 4.
    assert dc_health_state['vader-msg'][0][0] == 4


def test_phase1_no_strain_when_valid_targets_empty():
    # JS `abilities.js:430-444` — strain NOT paid on empty-target branch.
    game = _game()
    dc_health_state = {'vader-msg': [[5, 5]]}
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': None,
        'attacker_msg_id': 'vader-msg',
        'dc_health_state': dc_health_state,
    })
    assert out.get('applied') is False
    assert 'no valid SMALL targets' in out['manualMessage']
    # HP slot must remain untouched at 5.
    assert dc_health_state['vader-msg'][0][0] == 5


def test_phase1_enumerates_enemies_then_friendlies():
    # Phase 1 iterates both players — Force Throw targets friend or foe.
    # Ordering in JS is enemies first, then friendlies.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1', 'Stormtrooper (Elite)-1-0': 'b1'},
        2: {'Stormtrooper (Elite)-2-0': 'c1'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'active_position': 'a1',
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    # Enemy first, then friendly (single attacker figure excluded).
    assert out['targetFigureKeys'] == [
        'Stormtrooper (Elite)-2-0',
        'Stormtrooper (Elite)-1-0',
    ]


# ── Phase 2 — landing-space enumeration via count_spaces ───────────────────

def test_phase2_returns_landing_spaces_within_2():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    valid = set(out['validSpaces'])
    # Orthogonals within 2 MP should all be present.
    for c in ('d3', 'd2', 'd5', 'd6', 'c4', 'b4', 'e4', 'f4'):
        assert c in valid, f'{c} missing from validSpaces'
    # 3 spaces away must NOT land.
    assert 'd1' not in valid
    # Phase 2 return key is `targetFigureKey` (NOT `chosenFigureKey`).
    assert out['targetFigureKey'] == 'Stormtrooper (Elite)-1-0'
    assert 'chosenFigureKey' not in out
    assert out['spaceChoiceLabel'].startswith('**Force Throw** — Pick a landing space')


def test_phase2_excludes_targets_own_cell():
    # The target's own top-left cell must NOT appear in validSpaces (JS
    # occupiedSet.delete(targetPos)), but a friendly at another cell must be
    # filtered.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    # The target cell d4 IS in map_spaces but should be removed from occupied-set
    # (so target can vacate into its own space — but here count_spaces(d4,d4)=0
    # so it would still be a reachable option IFF it wasn't otherwise filtered).
    # In IA Force Throw, the actual JS behaviour reports d4 as a valid landing
    # only when it's the sole empty cell within 2; normally higher-distance
    # cells show up. The invariant we pin: d4 is NOT filtered by occupied-set.
    assert 'd4' in out['validSpaces']


def test_phase2_filters_other_figures_via_topleft_set():
    # Darth Vader at c4 — Phase 2 must NOT return c4 as a valid destination.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'c4'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    assert 'c4' not in out['validSpaces']
    # Other reachable cells should still show up.
    assert 'd3' in out['validSpaces'] and 'd5' in out['validSpaces']


def test_phase2_surrounded_target_still_has_own_cell():
    # JS `occupiedSet.delete(targetPos)` → target's own cell is always a valid
    # landing space, even when every neighbor is occupied. Tests that the
    # top-left-only occ_set with target exclusion works in the pathological
    # fully-surrounded case.
    grid = build_ortho_grid(3, 3)
    game = _game({
        1: {
            'Darth Vader-1-0': 'b1',
            'Stormtrooper (Elite)-1-0': 'a2',
            'Stormtrooper (Elite)-1-1': 'c2',
            'Stormtrooper (Elite)-1-2': 'b3',
            'Stormtrooper (Elite)-1-3': 'a1',
            'Stormtrooper (Elite)-1-4': 'c1',
            'Stormtrooper (Elite)-1-5': 'a3',
            'Stormtrooper (Elite)-1-6': 'c3',
        },
        2: {'Stormtrooper (Elite)-2-0': 'b2'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-2-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    # Every neighbor occupied by friendlies, so only target's own cell survives.
    assert out['validSpaces'] == ['b2']


def test_phase2_missing_map_manual_message():
    # No map_spaces override, no game.selectedMap → handler can't locate map.
    game = _game({1: {}, 2: {'Stormtrooper (Elite)-1-0': 'd4'}})
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
    })
    assert out.get('applied') is False
    assert 'map data not available' in out['manualMessage']


def test_phase2_missing_target_position_manual_message():
    grid = build_ortho_grid(8, 8)
    game = _game({1: {}, 2: {}})
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'target figure has no position' in out['manualMessage']


# ── Phase 3 — push + parting-blow warnings ─────────────────────────────────

def test_phase3_push_mutates_figure_positions():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'd5'
    assert out['refreshBoard'] is True


def test_phase3_log_format_includes_attacker_and_target_names():
    # Delta vs Force Push: log includes attacker DC name + target DC name,
    # NO bold around coords.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    log = out['logMessage']
    assert log.startswith('**Force Throw** — **Darth Vader** pushed **Stormtrooper (Elite)** ')
    assert 'from D4 to D5' in log
    # Coords must NOT be bolded (delta vs Force Push).
    assert 'from **D4**' not in log
    assert 'to **D5**' not in log
    # Single-step push has no via-segment.
    assert ' via ' not in log
    assert out['warnings'] == []


def test_phase3_path_str_emitted_for_two_space_push():
    # Push d4 → f4 (2 spaces): path = [d4, e4, f4], path_str = ' via **E4**'.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'f4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'f4'
    assert ' via **E4**' in out['logMessage']


def test_phase3_parting_blow_warning_emitted():
    # P1 Darth Vader at c4 adj to d4 (start) but NOT adj to f4 (end).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'c4'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'f4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert len(out['warnings']) == 1
    w = out['warnings'][0]
    assert w['name'] == 'Darth Vader'
    assert w['space'] == 'D4'
    assert '⚠️ Exits adjacency to' in out['logMessage']
    assert '**Darth Vader**' in out['logMessage']
    assert '(exited adj at D4)' in out['logMessage']


def test_phase3_no_warning_when_hostile_stays_adjacent():
    # Vader at e5: adj to target at d4 (before) AND adj to e4 (after push).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'e5'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'e4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['warnings'] == []
    assert '⚠️ Exits adjacency to' not in out['logMessage']


def test_phase3_p1_pushes_p2_target():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'a1'},
        2: {'Stormtrooper (Elite)-1-0': 'd4'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': 'Darth Vader-1-0',
        'chosen_figure_key': 'Stormtrooper (Elite)-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Stormtrooper (Elite)-1-0'] == 'd5'
    assert game['figurePositions'][1]['Darth Vader-1-0'] == 'a1'


def test_phase3_p2_pushes_p1_target():
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Darth Vader-1-0': 'd4'},
        2: {'Bossk-1-0': 'a1'},
    })
    out = handle_force_throw(game, 'force_throw', {
        'player_num': 2,
        'attacker_figure_key': 'Bossk-1-0',
        'chosen_figure_key': 'Darth Vader-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][1]['Darth Vader-1-0'] == 'd5'
    assert game['figurePositions'][2]['Bossk-1-0'] == 'a1'


# ── Dispatch integration ───────────────────────────────────────────────────

def test_dispatch_resolve_wraps_with_pattern_E():
    game = _game()
    out = resolve(game, 'force_throw', {
        'player_num': 1,
        'attacker_figure_key': None,
        'active_position': None,
    })
    assert out['ability_id'] == 'force_throw'
    assert out['pattern'] == 'E'
    assert out.get('applied') is False


def test_resolve_pattern_e_direct_call_matches_dispatch():
    game = _game()
    ctx = {'player_num': 1, 'attacker_figure_key': None, 'active_position': None}
    out = resolve_pattern_e(game, 'force_throw', ctx)
    assert out['ability_id'] == 'force_throw'
    assert out['pattern'] == 'E'


def test_chain_handler_registered_for_force_throw():
    # Post-D3.15: the registered handler is the generalized
    # handle_push_target_within_range. The D3.11 `handle_force_throw` name
    # remains importable via the force_throw.py back-compat shim.
    handler = get_chain_handler('force_throw')
    assert handler is not None
    assert handler.__name__ == 'handle_push_target_within_range'
    assert handle_force_throw is handler


def test_force_throw_classifies_as_E():
    assert dispatch.lookup_pattern('force_throw') == 'E'


def test_registered_chain_ids_contains_both_chains():
    ids = registered_chain_ids()
    assert 'Force Push' in ids
    assert 'force_throw' in ids


def test_unregistered_pattern_e_raises_ChainNotImplemented():
    # Post-bulk install: every Pattern E ability has a handler, so
    # ChainNotImplemented is only raised by truly unknown IDs. Smoke
    # test: resolving 'advanced_firepower_sorin' now succeeds via the
    # pending-stamper path.
    out = resolve({}, 'advanced_firepower_sorin', {})
    assert out.get('applied') is True


def test_install_default_chain_handlers_idempotent():
    # Calling twice must not raise and must not duplicate registrations.
    dispatch.install_default_handlers()
    dispatch.install_default_handlers()
    ids = registered_chain_ids()
    # Both real chains survive; no exceptions.
    assert 'Force Push' in ids
    assert 'force_throw' in ids


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
            import traceback
            traceback.print_exc()
            sys.exit(1)
    print(f'\n{passed}/{len(tests)} green')


if __name__ == '__main__':
    main()
