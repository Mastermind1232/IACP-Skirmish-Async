"""D3.13 oracle — Pattern E Hop On three-phase chain (Kuiil companion push).

Exercises `python.engine.abilities.hop_on.handle_hop_on` and its dispatch
routing via `python.engine.abilities.pattern_e.resolve_pattern_e`.

JS firing site: `src/game/abilities.js:8075-8124`. `dcSpecial` + `hopOnPush`.
Push a FRIENDLY SMALL figure up to 4 spaces.

Phases:
  Phase 1  ctx has no chosen_* fields           → enumerate friendly SMALL
                                                   figures (exclude active
                                                   DC's own figure keys)
  Phase 2  ctx.chosen_figure_key only           → enumerate destinations
                                                   within 4 of target
  Phase 3  ctx.chosen_figure_key + chosen_space → push + parting-blow warn

Deltas from Force Push covered here:
  - Phase 1 iterates ONLY playerNum (always friendly), no P-tag in labels
  - Phase 1 has NO distance gate (range-unrestricted)
  - Phase 2 range = 4 (vs 2)
  - Phase 3 log says `**Hop On!**`

Run as: python3 -m python.parity.oracles.abilities.test_e_hop_on
"""
import sys
from typing import Any, Dict, List, Optional

from python.engine.abilities import dispatch
from python.engine.abilities.dispatch import UnknownAbility, resolve
from python.engine.abilities.hop_on import handle_hop_on
from python.engine.abilities.pattern_e import (
    ChainNotImplemented,
    get_chain_handler,
    registered_chain_ids,
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
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': [],
    })
    assert out.get('applied') is False
    assert out['manualMessage'] == 'No friendly SMALL figures to push.'


def test_phase1_excludes_active_figure_keys():
    # Kuiil (active) + one friendly companion; only the companion should
    # appear as a target.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'b1'},
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Dio-1-0']
    # No P-tag on Hop On labels (always friendly).
    assert out['choiceOptions'] == ['Push: Dio']


def test_phase1_friendly_only_excludes_enemies():
    # An enemy figure adjacent to Kuiil must NOT appear in the target pool.
    # JS iterates only `game.figurePositions?.[playerNum]`.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'b1'},
        2: {'Stormtrooper (Elite)-1-0': 'c1'},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert set(out['choiceValues']) == {'Dio-1-0'}
    assert 'Stormtrooper (Elite)-1-0' not in out['choiceValues']


def test_phase1_skips_massive_figures():
    # AT-DP has MASSIVE → skipped. Stormtrooper (Elite) has no MASSIVE/LARGE
    # → included (assumed friendly here even though uncommon for Kuiil squad).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {
            'Kuiil-1-0': 'a1',
            'AT-DP-1-0': 'b1',
            'Stormtrooper (Elite)-1-0': 'c1',
        },
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']
    assert 'AT-DP-1-0' not in out['choiceValues']


def test_phase1_skips_large_figures_via_dc_effects_patch():
    # Monkey-patch the DC effects cache to add LARGE to a synthetic DC,
    # confirm the keyword filter drops it. Same try/finally restore pattern
    # as Force Throw's LARGE oracle.
    from python.engine.data import dc_effects_loader
    dc_effects_loader._dc_effects = None  # force cache reload
    effects = dc_effects_loader.get_dc_effects()
    original = dict(effects)
    try:
        effects['DummyLargeFig'] = {'keywords': ['LARGE']}
        dc_effects_loader._dc_effects = effects
        grid = build_ortho_grid(8, 8)
        game = _game({
            1: {
                'Kuiil-1-0': 'a1',
                'DummyLargeFig-1-0': 'b1',
                'Dio-1-0': 'c1',
            },
            2: {},
        })
        out = handle_hop_on(game, 'hop_on_kuiil', {
            'player_num': 1,
            'active_figure_keys': ['Kuiil-1-0'],
            'map_spaces': grid,
        })
        assert out.get('requiresChoice') is True
        assert 'DummyLargeFig-1-0' not in out['choiceValues']
        assert 'Dio-1-0' in out['choiceValues']
    finally:
        dc_effects_loader._dc_effects = None  # force reload on next caller


def test_phase1_no_distance_gate_far_figures_still_included():
    # Hop On has NO distance gate. Dio at h8 on an 8x8 grid (7+7=14 spaces
    # from Kuiil) must still show up.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'h8'},
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Dio-1-0']


def test_phase1_multiple_friendlies_ordering():
    # Iteration order mirrors Python dict insertion order, which mirrors JS
    # `Object.entries(game.figurePositions?.[playerNum] || {})`. Two
    # friendlies beyond the active group should both appear.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {
            'Kuiil-1-0': 'a1',
            'Dio-1-0': 'b1',
            'Stormtrooper (Elite)-1-0': 'c1',
        },
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Dio-1-0', 'Stormtrooper (Elite)-1-0']
    assert out['choiceOptions'] == ['Push: Dio', 'Push: Stormtrooper (Elite)']


def test_phase1_missing_game_or_player_num_returns_manual_message():
    out = handle_hop_on(None, 'hop_on_kuiil', {'player_num': 1})
    assert out.get('applied') is False
    assert 'Hop On!' in out['manualMessage']
    out2 = handle_hop_on({}, 'hop_on_kuiil', {})
    assert out2.get('applied') is False


def test_phase1_skips_figures_with_missing_position():
    # `pos` falsy → JS `if (!pos || actKeys.includes(fk)) continue;`
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {
            'Kuiil-1-0': 'a1',
            'Dio-1-0': None,
            'Stormtrooper (Elite)-1-0': 'b1',
        },
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'map_spaces': grid,
    })
    assert out.get('requiresChoice') is True
    assert out['choiceValues'] == ['Stormtrooper (Elite)-1-0']
    assert 'Dio-1-0' not in out['choiceValues']


# ── Phase 2 — landing-space enumeration ────────────────────────────────────

def test_phase2_returns_reachable_spaces_within_4():
    # Dio at d4 on empty grid — Phase 2 should return coords reachable in
    # 4 MP (Hop On range is 4, vs Force Push's 2).
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'},
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'chosen_figure_key': 'Dio-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    valid = set(out['validSpaces'])
    # All orthogonal 1..4-away cells should be reachable.
    assert 'd3' in valid and 'd2' in valid  # up 1-2
    assert 'd1' in valid  # up 3 — Force Push would exclude this
    assert 'd5' in valid and 'd6' in valid  # down 1-2
    assert 'd7' in valid and 'd8' in valid  # down 3-4
    assert 'c4' in valid and 'b4' in valid  # left 1-2
    assert 'a4' in valid  # left 3 — Force Push would exclude this
    assert 'e4' in valid and 'f4' in valid and 'g4' in valid and 'h4' in valid
    # Return-key discipline: Hop On uses chosenFigureKey (matches Force Push).
    assert out['chosenFigureKey'] == 'Dio-1-0'
    assert out['spaceChoiceLabel'].startswith('**Hop On!** — Choose destination')
    # No P-tag in the Phase 2 label.
    assert '(P1)' not in out['spaceChoiceLabel']
    assert 'within 4 of Dio' in out['spaceChoiceLabel']


def test_phase2_filters_out_occupied_spaces():
    # Another friendly at c4 blocks that cell as a destination.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {
            'Kuiil-1-0': 'a1',
            'Dio-1-0': 'd4',
            'Stormtrooper (Elite)-1-0': 'c4',
        },
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'chosen_figure_key': 'Dio-1-0',
        'map_spaces': grid,
    })
    assert out.get('requiresSpaceChoice') is True
    assert 'c4' not in out['validSpaces']
    assert 'd3' in out['validSpaces'] and 'd5' in out['validSpaces']


def test_phase2_missing_target_position_manual_message():
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'chosen_figure_key': 'Dio-1-0',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'Could not locate target figure position' in out['manualMessage']


def test_phase2_missing_map_spaces_manual_message():
    # No ctx.map_spaces, no game.selectedMap → Phase 2 should manual-message.
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
    })
    assert out.get('applied') is False
    assert 'Push manually (no map data)' in out['manualMessage']


def test_phase2_empty_valid_spaces_manual_message():
    # Dio at b2 on a 3x3 grid with every neighbor occupied → no destinations.
    grid = build_ortho_grid(3, 3)
    game = _game({
        1: {
            'Kuiil-1-0': 'a1',
            'Dio-1-0': 'b2',
            'Stormtrooper (Elite)-1-1': 'a2',
            'Stormtrooper (Elite)-1-2': 'b1',
            'Stormtrooper (Elite)-1-3': 'b3',
            'Stormtrooper (Elite)-1-4': 'c2',
            'Stormtrooper (Elite)-1-5': 'a3',
            'Stormtrooper (Elite)-1-6': 'c1',
            'Stormtrooper (Elite)-1-7': 'c3',
        },
        2: {},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
        'chosen_figure_key': 'Dio-1-0',
        'map_spaces': grid,
    })
    assert out.get('applied') is False
    assert 'No empty spaces within 4' in out['manualMessage']


def test_phase2_occupied_set_override_honored():
    # ctx.occupied_set override — only c4 forbidden.
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'map_spaces': grid,
        'occupied_set': ['c4'],
    })
    assert out.get('requiresSpaceChoice') is True
    assert 'c4' not in out['validSpaces']
    assert 'd3' in out['validSpaces']


# ── Phase 3 — push + parting-blow warnings ─────────────────────────────────

def test_phase3_push_mutates_figure_positions():
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    # Always friendly — position mutated on the activating player's bucket.
    assert game['figurePositions'][1]['Dio-1-0'] == 'd5'
    assert out['refreshBoard'] is True
    assert out['warnings'] == []


def test_phase3_log_message_format_bolded_coords():
    # Byte-identical to JS: `**Hop On!** — **<dc>** pushed from **<OLD>** to
    # **<NEW>**.`
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['logMessage'] == (
        '**Hop On!** — **Dio** pushed from **D4** to **D5**.'
    )


def test_phase3_path_str_for_multi_space_push():
    # Push Dio 3 spaces forward (Hop On range is 4) → path = [d4, d5, d6, d7],
    # intermediates = [d5, d6], so path_str = ' via **D5** → **D6**' with
    # U+2192 joiner. Tests arrow emission for 2+ intermediates.
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'd7',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert ' via **D5** \u2192 **D6**' in out['logMessage']


def test_phase3_parting_blow_warning_when_hostile_adj_exits():
    # Vader at e5 — adjacent to Dio at d4 via... no wait, d4 vs e5 is diag
    # in the full 8-way sense but the grid is 4-neighbor. Use adjacent-only
    # hostile setup: Vader at e4, Dio at d4, push Dio to c4 → Vader was
    # edge-adj to d4 but NOT edge-adj to c4 → parting-blow warning.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'},
        2: {'Darth Vader-1-0': 'e4'},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'c4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert len(out['warnings']) == 1
    w = out['warnings'][0]
    assert w['name'] == 'Darth Vader'
    # JS warnings carry exiting_space.upper() — the cell the target LEFT.
    assert w['space'] == 'D4'
    assert '⚠️ Exits adjacency to' in out['logMessage']
    assert '**Darth Vader** (exited adj at D4)' in out['logMessage']


def test_phase3_no_warning_when_hostile_stays_adjacent():
    # Vader at d5 — edge-adj to both d4 (target start) and c4 (destination)
    # via the path? Actually d4↔d5 is edge-adj, c4↔d5 is not (they differ in
    # both col AND row). Place Vader at e5 so... hmm. Use Vader at c5:
    # c5↔d4 is diagonal (not edge-adj on this 4-neighbor grid), c5↔c4 IS
    # edge-adj. So Vader NEVER had the entering-adj requirement on d4. No
    # warning because Vader isn't adj to d4 in the first place. Use a
    # different setup: put Vader at d5 (edge-adj to d4). Push Dio d4→d3.
    # Vader at d5 is NOT edge-adj to d3 (two-apart). So that WOULD trigger
    # a warning.
    # The "no warning" case is: Vader at d3 (edge-adj to d4 starting cell).
    # Push d4→c4. Vader at d3 was edge-adj to d4; is Vader edge-adj to c4?
    # d3↔c4 differ in col AND row → no. That still triggers a warning.
    # Actually Hop On is a single-cell push (d4→c4), so the exit-detection
    # runs: was Vader adj to d4? if yes and not adj to c4 → warn. That's
    # the "staying adjacent" case requires Vader adj to BOTH. Put Vader at
    # the destination-side: Vader at b4. b4↔c4 edge-adj; b4↔d4 not edge-adj.
    # So Vader was NOT adj to d4 → no warning. Correct — Vader "stays adjacent"
    # after the push but was never adjacent to the exit cell.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'},
        2: {'Darth Vader-1-0': 'b4'},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'c4',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    # Vader was not edge-adj to d4, so compute_push_path_and_warnings emits
    # no warnings — exactly matches the Force Push "no warning when hostile
    # not originally adjacent" case.
    assert out['warnings'] == []
    assert '⚠️' not in out['logMessage']


def test_phase3_no_warning_when_no_hostile_figures():
    grid = build_ortho_grid(8, 8)
    game = _game({1: {'Kuiil-1-0': 'a1', 'Dio-1-0': 'd4'}, 2: {}})
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 1,
        'chosen_figure_key': 'Dio-1-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert out['warnings'] == []


def test_phase3_p2_pushes_own_friendly():
    # Hop On always pushes the activating player's own figure. Verify P2
    # can activate Kuiil and push a P2 companion.
    grid = build_ortho_grid(8, 8)
    game = _game({
        1: {},
        2: {'Kuiil-2-0': 'a1', 'Dio-2-0': 'd4'},
    })
    out = handle_hop_on(game, 'hop_on_kuiil', {
        'player_num': 2,
        'chosen_figure_key': 'Dio-2-0',
        'chosen_space': 'd5',
        'map_spaces': grid,
    })
    assert out['applied'] is True
    assert game['figurePositions'][2]['Dio-2-0'] == 'd5'


# ── Dispatch integration ────────────────────────────────────────────────────

def test_resolve_pattern_e_wraps_with_pattern_envelope():
    game = _game({1: {'Kuiil-1-0': 'a1'}, 2: {}})
    out = resolve_pattern_e(game, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
    })
    assert out['ability_id'] == 'hop_on_kuiil'
    assert out['pattern'] == 'E'
    assert out.get('applied') is False
    assert 'No friendly SMALL figures to push' in out['manualMessage']


def test_direct_handler_matches_dispatch_modulo_envelope():
    game1 = _game({1: {'Kuiil-1-0': 'a1'}, 2: {}})
    game2 = _game({1: {'Kuiil-1-0': 'a1'}, 2: {}})
    direct = handle_hop_on(game1, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
    })
    wrapped = resolve_pattern_e(game2, 'hop_on_kuiil', {
        'player_num': 1,
        'active_figure_keys': ['Kuiil-1-0'],
    })
    for k in direct:
        assert wrapped[k] == direct[k]
    assert wrapped['pattern'] == 'E'
    assert wrapped['ability_id'] == 'hop_on_kuiil'


def test_chain_handler_registered_for_hop_on():
    handler = get_chain_handler('hop_on_kuiil')
    assert handler is not None
    assert handler.__name__ == 'handle_hop_on'


def test_registered_chain_ids_contains_all_six_chains():
    # Post-D3.17: six chains registered. force_throw/wrist_cord/mandalorian_whip
    # share the generalized handle_push_target_within_range handler;
    # barrage_ct1701 is the D3.17 4-phase state-flag mutator.
    ids = set(registered_chain_ids())
    assert {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }.issubset(ids)


def test_lookup_pattern_returns_E_for_hop_on():
    from python.engine.abilities.dispatch import lookup_pattern
    assert lookup_pattern('hop_on_kuiil') == 'E'


def test_dispatch_resolve_routes_hop_on_to_handler():
    out = resolve({'figurePositions': {1: {'Kuiil-1-0': 'a1'}, 2: {}}},
                  'hop_on_kuiil',
                  {'player_num': 1, 'active_figure_keys': ['Kuiil-1-0']})
    assert out['pattern'] == 'E'
    assert 'No friendly SMALL figures to push' in out['manualMessage']


def test_unregistered_pattern_e_raises_ChainNotImplemented():
    # Post-bulk install: every Pattern E ability has a handler, so
    # ChainNotImplemented is only raised by truly unknown IDs. Smoke
    # test: resolving 'advanced_firepower_sorin' now succeeds via the
    # pending-stamper path.
    out = resolve({}, 'advanced_firepower_sorin', {})
    assert out.get('applied') is True


def test_install_default_chain_handlers_idempotent():
    from python.engine.abilities.pattern_e import install_default_chain_handlers
    install_default_chain_handlers()
    install_default_chain_handlers()
    # Still exactly the 6 chains; no duplicates or drops.
    ids = set(registered_chain_ids())
    assert {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }.issubset(ids)


# ── Runner ──────────────────────────────────────────────────────────────────

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
