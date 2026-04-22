"""D3.10 — Oracle tests for Pattern E.2 Fluctuation mission-rule port.

Parity targets (JS golden spec):
  `tests/domain/oracle/fluctuation-swap-oracles.test.js`
    - ORACLE-FLUCT-001: lazy init + persistence (001a/b)
    - ORACLE-FLUCT-002: VP scoring uses canonical (swapped) positions (002a/b/c)
    - ORACLE-FLUCT-003: swap mechanic coordinate exchange (003a/b)

This file ports the 6 JS probes byte-for-byte AND adds coverage for:
  - Queue init only on Lothal Wastes B (no-op on other maps/variants)
  - Two-click UX (first-click saves, second-click executes)
  - Wrong-player rejection + no-queue noop
  - Skip flow (queue advance without swap)
  - fluctuationSwappedThisRound both-coords append
  - Round-start + round-end cleanup field classes
  - Pattern E chain registry discipline (no pollution)

The oracle uses the synthetic fake-map-tokens layout mirroring
`data/map-tokens.json` lothal-wastes.missionB. Real map-tokens data lives in
`data/map-tokens.json` at top-level `{source, maps}`; tests pass the pre-
extracted `maps` dict (shape that mirrors `getMapTokensData()` output from JS).
"""
from __future__ import annotations

import sys

from python.engine.abilities import dispatch
from python.engine.abilities.pattern_e import (
    ChainNotImplemented,
    get_chain_handler,
    registered_chain_ids,
)
from python.engine.missions.lothal_wastes_b_fluctuation import (
    MAP_ID,
    VARIANT,
    apply_fluctuation_swap,
    cleanup_fluctuation_round_end,
    cleanup_fluctuation_round_start,
    get_current_fluctuation_positions,
    init_fluctuation_swap_queue,
    score_controlled_fluctuations,
    skip_fluctuation_swap,
    _extract_color_from_image,
)


# ── Fake map-tokens data ────────────────────────────────────────────────────

def fake_map_tokens_data():
    """Mirrors JS oracle's fakeMapTokensData() (fluctuation-swap-oracles.test.js:31-52).

    Returns the `maps` shape — caller passes this directly to the port
    functions (NOT the top-level `{source, maps}` wrapper from raw JSON).
    """
    return {
        MAP_ID: {
            'missionB': {
                'tokenTypes': [
                    {'id': '0', 'label': 'Fluctuation', 'image': 'Mission Token--Neutral Yellow.gif'},
                    {'id': '1', 'label': 'Fluctuation', 'image': 'Mission Token--Neutral Blue.gif'},
                    {'id': '2', 'label': 'Fluctuation', 'image': 'Mission Token--Neutral Blue.gif'},
                    {'id': '3', 'label': 'Fluctuation', 'image': 'Mission Token--Neutral Green.gif'},
                    {'id': '4', 'label': 'Fluctuation', 'image': 'Mission Token--Neutral Red.gif'},
                ],
                'positions': {
                    '0': ['j10', 'p10'],
                    '1': [],
                    '2': ['h21', 't21'],
                    '3': ['i16', 'q16'],
                    '4': ['l7', 'o7'],
                },
            },
        },
    }


def build_game(p1_positions=None, p2_positions=None,
               initiative_pn=1):
    init_id = 'p1' if initiative_pn == 1 else 'p2'
    return {
        'player1Id': 'p1',
        'player2Id': 'p2',
        'initiativePlayerId': init_id,
        'player1VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'player2VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'figurePositions': {1: dict(p1_positions or {}), 2: dict(p2_positions or {})},
        'figurePowerTokens': {},
        'ended': False,
    }


# ── Color-extraction primitive ──────────────────────────────────────────────

def test_extract_color_yellow():
    assert _extract_color_from_image('Mission Token--Neutral Yellow.gif') == 'yellow'


def test_extract_color_blue():
    assert _extract_color_from_image('Mission Token--Neutral Blue.gif') == 'blue'


def test_extract_color_green():
    assert _extract_color_from_image('Mission Token--Neutral Green.gif') == 'green'


def test_extract_color_red():
    assert _extract_color_from_image('Mission Token--Neutral Red.gif') == 'red'


def test_extract_color_none_from_non_matching():
    assert _extract_color_from_image('Other Image.png') is None


def test_extract_color_none_from_empty():
    assert _extract_color_from_image('') is None
    assert _extract_color_from_image(None) is None


# ── ORACLE-FLUCT-001: lazy init + persistence ───────────────────────────────

def test_fluct_001a_initializes_from_static_json_on_first_call():
    game = {}
    positions = get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())
    assert game.get('fluctuationPositions') is not None, 'Should set game.fluctuationPositions'
    assert game['fluctuationPositions'] is positions, 'Return value should be game.fluctuationPositions'
    assert positions['0'] == ['j10', 'p10']
    assert positions['1'] == []
    assert positions['2'] == ['h21', 't21']
    assert positions['3'] == ['i16', 'q16']
    assert positions['4'] == ['l7', 'o7']


def test_fluct_001b_returns_existing_positions_without_re_reading():
    swapped = {'0': ['l7', 'p10'], '4': ['j10', 'o7']}
    game = {'fluctuationPositions': swapped}
    positions = get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())
    assert positions is swapped, 'Should return the existing object, not a new copy'
    assert positions['0'] == ['l7', 'p10'], 'Swapped positions preserved'


def test_fluct_001c_normalizes_coords_on_lazy_init():
    """JS uses normalizeCoord() on each position (mission-rules.js:30)."""
    uppercased = {
        MAP_ID: {
            'missionB': {
                'tokenTypes': fake_map_tokens_data()[MAP_ID]['missionB']['tokenTypes'],
                'positions': {'0': ['J10', 'P10']},  # uppercase
            },
        },
    }
    game = {}
    positions = get_current_fluctuation_positions(game, MAP_ID, uppercased)
    assert positions['0'] == ['j10', 'p10'], 'Coords must be normalized (lowercased)'


def test_fluct_001d_missing_map_returns_empty_dict():
    game = {}
    positions = get_current_fluctuation_positions(game, 'unknown-map', fake_map_tokens_data())
    assert positions == {}


# ── ORACLE-FLUCT-002: VP scoring uses canonical positions ───────────────────

def test_fluct_002a_vp_scored_at_original_positions_when_no_swap():
    game = build_game(
        p1_positions={'Stormtrooper-1-0': 'j10'},
        p2_positions={'Luke Skywalker-1-0': 'i16'},
    )
    def controller(_g, _mid, coord):
        if coord == 'j10': return 1
        if coord == 'i16': return 2
        return None
    result = score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    assert game['player1VP']['objectives'] == 1, 'P1 gets 1 VP for j10'
    assert game['player2VP']['objectives'] == 1, 'P2 gets 1 VP for i16'
    assert result['vp_awarded'] == {1: 1, 2: 1}


def test_fluct_002b_vp_scored_at_swapped_positions():
    game = build_game(p1_positions={'Stormtrooper-1-0': 'l7'})
    game['fluctuationPositions'] = {
        '0': ['l7', 'p10'],    # Yellow swapped from j10 → l7
        '1': [],
        '2': ['h21', 't21'],
        '3': ['i16', 'q16'],
        '4': ['j10', 'o7'],    # Red swapped from l7 → j10
    }
    def controller(_g, _mid, coord):
        return 1 if coord == 'l7' else None
    score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    assert game['player1VP']['objectives'] == 1, 'P1 gets 1 VP for controlling l7 (now Yellow)'
    tokens = game.get('figurePowerTokens', {}).get('Stormtrooper-1-0', [])
    assert 'Surge' in tokens, f'Figure on Yellow fluctuation should get Surge token, got: {tokens}'


def test_fluct_002c_power_tokens_match_swapped_color_not_original():
    """j10 originally had Yellow; after swap j10 has Red."""
    game = build_game(p1_positions={'Stormtrooper-1-0': 'j10'})
    game['fluctuationPositions'] = {
        '0': ['l7', 'p10'],    # Yellow moved j10 → l7
        '1': [],
        '2': ['h21', 't21'],
        '3': ['i16', 'q16'],
        '4': ['j10', 'o7'],    # Red moved l7 → j10
    }
    def controller(_g, _mid, coord):
        return 1 if coord == 'j10' else None
    score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    tokens = game.get('figurePowerTokens', {}).get('Stormtrooper-1-0', [])
    assert 'Damage' in tokens, f'Figure on Red fluctuation (swapped to j10) should get Damage, got: {tokens}'
    assert 'Surge' not in tokens, 'Should NOT get Surge (Yellow was swapped away from j10)'


def test_fluct_002d_no_controller_no_vp():
    game = build_game(p1_positions={'Stormtrooper-1-0': 'j10'})
    def controller(_g, _mid, _c):
        return None
    score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    assert game['player1VP']['objectives'] == 0
    assert game['player2VP']['objectives'] == 0
    # Power token still granted (grant condition is separate from control)
    tokens = game.get('figurePowerTokens', {}).get('Stormtrooper-1-0', [])
    assert 'Surge' in tokens


def test_fluct_002e_empty_positions_slot_is_skipped():
    """Type-id 1 has empty positions list — must not crash, no tokens/VP."""
    game = build_game(p1_positions={'Stormtrooper-1-0': 'j10'})
    def controller(_g, _mid, coord):
        return 1 if coord == 'j10' else None
    result = score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    # Empty type-1 iteration completes silently; scoring at j10 (type-0) still fires
    assert result['vp_awarded'][1] == 1


def test_fluct_002f_grant_power_token_false_suppresses_token_grant():
    game = build_game(p1_positions={'Stormtrooper-1-0': 'j10'})
    def controller(_g, _mid, coord):
        return 1 if coord == 'j10' else None
    score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller,
                                  grant_power_token=False)
    tokens = game.get('figurePowerTokens', {}).get('Stormtrooper-1-0', [])
    assert 'Surge' not in tokens, 'grant_power_token=False must suppress token grant'
    assert game['player1VP']['objectives'] == 1, 'VP still awarded'


def test_fluct_002g_scoring_sums_across_multiple_controlled_fluctuations():
    """P1 controls j10 (Yellow) AND p10 (Yellow) AND i16 (Green) → 3 VP."""
    game = build_game(
        p1_positions={
            'Stormtrooper-1-0': 'j10',
            'Stormtrooper-1-1': 'p10',
            'Stormtrooper-1-2': 'i16',
        },
    )
    def controller(_g, _mid, coord):
        return 1 if coord in ('j10', 'p10', 'i16') else None
    score_controlled_fluctuations(game, MAP_ID, fake_map_tokens_data(), controller)
    assert game['player1VP']['objectives'] == 3
    tokens_0 = game['figurePowerTokens']['Stormtrooper-1-0']
    tokens_1 = game['figurePowerTokens']['Stormtrooper-1-1']
    tokens_2 = game['figurePowerTokens']['Stormtrooper-1-2']
    assert 'Surge' in tokens_0 and 'Surge' in tokens_1, 'Both Yellow fluctuations grant Surge'
    assert 'Block' in tokens_2, 'Green grants Block'


# ── ORACLE-FLUCT-003: swap mechanic coordinate exchange ─────────────────────

def test_fluct_003a_swap_exchanges_coords_in_positions_object():
    """Cross-color swap: j10 (Yellow/type0) ↔ l7 (Red/type4)."""
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())

    # First click: j10
    r1 = apply_fluctuation_swap(game, 1, 'j10')
    assert r1['phase'] == 'first'
    assert r1['source'] == 'j10'
    assert game['pendingFluctuationSwapFirst'] == 'j10'

    # Second click: l7
    r2 = apply_fluctuation_swap(game, 1, 'l7')
    assert r2['applied'] is True
    assert r2['source'] == 'j10'
    assert r2['target'] == 'l7'

    positions = game['fluctuationPositions']
    assert 'l7' in positions['0'], 'Yellow has l7 after swap'
    assert 'j10' not in positions['0'], 'Yellow no longer at j10'
    assert 'j10' in positions['4'], 'Red has j10 after swap'
    assert 'l7' not in positions['4'], 'Red no longer at l7'
    assert positions['2'] == ['h21', 't21'], 'Blue unchanged'
    assert positions['3'] == ['i16', 'q16'], 'Green unchanged'


def test_fluct_003b_swap_within_same_color_group_is_valid():
    """In-color swap: h21 ↔ t21 (both type-2 Blue). End state: same coords,
    just swapped within array positions."""
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())

    apply_fluctuation_swap(game, 1, 'h21')
    r2 = apply_fluctuation_swap(game, 1, 't21')
    assert r2['applied'] is True

    positions = game['fluctuationPositions']
    assert 'h21' in positions['2'], 'h21 still in type-2'
    assert 't21' in positions['2'], 't21 still in type-2'


def test_fluct_003c_both_coords_appended_to_swapped_this_round():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1]
    game['fluctuationSwappedThisRound'] = []
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())

    apply_fluctuation_swap(game, 1, 'j10')
    apply_fluctuation_swap(game, 1, 'l7')

    assert 'j10' in game['fluctuationSwappedThisRound']
    assert 'l7' in game['fluctuationSwappedThisRound']
    assert len(game['fluctuationSwappedThisRound']) == 2


def test_fluct_003d_swap_normalizes_input_coord_case():
    """Uppercase input must be normalized before lookup (JS normalizeCoord
    on both sides of the comparison at map-events.js:178-181)."""
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())

    apply_fluctuation_swap(game, 1, 'J10')   # uppercase
    r2 = apply_fluctuation_swap(game, 1, 'L7')
    assert r2['applied'] is True
    assert r2['source'] == 'j10', 'Source normalized to lowercase'
    assert r2['target'] == 'l7', 'Target normalized to lowercase'


# ── Queue init (Lothal Wastes B only) ───────────────────────────────────────

def test_fluct_queue_init_on_lothal_wastes_b():
    game = build_game(initiative_pn=1)
    ok = init_fluctuation_swap_queue(game, MAP_ID, VARIANT)
    assert ok is True
    assert game['pendingFluctuationSwapQueue'] == [1, 2]
    assert game['fluctuationSwappedThisRound'] == []
    assert game['pendingFluctuationSwapFirst'] is None


def test_fluct_queue_respects_initiative_p2():
    game = build_game(initiative_pn=2)
    init_fluctuation_swap_queue(game, MAP_ID, VARIANT)
    assert game['pendingFluctuationSwapQueue'] == [2, 1], 'Initiative player is first in queue'


def test_fluct_queue_init_noop_on_other_maps():
    game = build_game()
    ok = init_fluctuation_swap_queue(game, 'anchorhead', VARIANT)
    assert ok is False
    assert 'pendingFluctuationSwapQueue' not in game


def test_fluct_queue_init_noop_on_lothal_wastes_variant_a():
    game = build_game()
    ok = init_fluctuation_swap_queue(game, MAP_ID, 'a')
    assert ok is False
    assert 'pendingFluctuationSwapQueue' not in game


# ── Swap/Skip: queue guards & advance ───────────────────────────────────────

def test_fluct_swap_no_queue_returns_reason():
    game = build_game()
    r = apply_fluctuation_swap(game, 1, 'j10')
    assert r == {'applied': False, 'reason': 'no-queue'}


def test_fluct_swap_wrong_player_returns_expected():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1, 2]
    r = apply_fluctuation_swap(game, 2, 'j10')
    assert r == {'applied': False, 'reason': 'wrong-player', 'expected': 1}
    assert game.get('pendingFluctuationSwapFirst') is None, 'Wrong-player must not save first'


def test_fluct_swap_queue_advance_after_successful_swap():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1, 2]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())
    apply_fluctuation_swap(game, 1, 'j10')
    r = apply_fluctuation_swap(game, 1, 'l7')
    assert r['queue_advanced'] is True
    assert r['next_player'] == 2
    assert game['pendingFluctuationSwapQueue'] == [2]


def test_fluct_swap_empties_queue_on_last_player():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [2]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())
    apply_fluctuation_swap(game, 2, 'j10')
    r = apply_fluctuation_swap(game, 2, 'l7')
    assert r['next_player'] is None
    assert game['pendingFluctuationSwapQueue'] == []


def test_fluct_swap_coord_not_found():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1]
    get_current_fluctuation_positions(game, MAP_ID, fake_map_tokens_data())
    apply_fluctuation_swap(game, 1, 'j10')
    r = apply_fluctuation_swap(game, 1, 'z99')  # not a fluctuation
    assert r['applied'] is False
    assert r['reason'] == 'coord-not-found'


def test_fluct_skip_no_queue_returns_reason():
    game = build_game()
    r = skip_fluctuation_swap(game, 1)
    assert r == {'applied': False, 'reason': 'no-queue'}


def test_fluct_skip_wrong_player_returns_expected():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1, 2]
    r = skip_fluctuation_swap(game, 2)
    assert r == {'applied': False, 'reason': 'wrong-player', 'expected': 1}


def test_fluct_skip_advances_queue_and_clears_first():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [1, 2]
    game['pendingFluctuationSwapFirst'] = 'j10'  # pretend first-click was made
    r = skip_fluctuation_swap(game, 1)
    assert r == {'skipped': True, 'next_player': 2}
    assert game['pendingFluctuationSwapQueue'] == [2]
    assert game['pendingFluctuationSwapFirst'] is None


def test_fluct_skip_empties_queue_on_last_player():
    game = build_game()
    game['pendingFluctuationSwapQueue'] = [2]
    r = skip_fluctuation_swap(game, 2)
    assert r == {'skipped': True, 'next_player': None}
    assert game['pendingFluctuationSwapQueue'] == []


# ── Round cleanup ───────────────────────────────────────────────────────────

def test_fluct_cleanup_round_start_resets_swapped_list():
    game = {'fluctuationSwappedThisRound': ['j10', 'l7']}
    cleanup_fluctuation_round_start(game)
    assert game['fluctuationSwappedThisRound'] == []


def test_fluct_cleanup_round_start_creates_field_when_missing():
    game = {}
    cleanup_fluctuation_round_start(game)
    assert game['fluctuationSwappedThisRound'] == []


def test_fluct_cleanup_round_end_deletes_pending_fields():
    game = {
        'pendingFluctuationSwapQueue': [1, 2],
        'pendingFluctuationSwapFirst': 'j10',
        'fluctuationSwappedThisRound': ['j10', 'l7'],  # should NOT be deleted
    }
    cleanup_fluctuation_round_end(game)
    assert 'pendingFluctuationSwapQueue' not in game
    assert 'pendingFluctuationSwapFirst' not in game
    assert game['fluctuationSwappedThisRound'] == ['j10', 'l7'], (
        'Only pending fields are deleted at round-end; fluctuationSwappedThisRound '
        'resets at round-start (activation-state.js:383 ROUND_ARRAY_FLAGS).'
    )


def test_fluct_cleanup_round_end_is_noop_on_missing_fields():
    """Mirrors JS `delete` on missing keys — silent no-op, no KeyError."""
    game = {}
    cleanup_fluctuation_round_end(game)
    assert game == {}


# ── Pattern E chain registry discipline ─────────────────────────────────────

def test_fluct_not_registered_in_pattern_e_chain_registry():
    """E.2 Fluctuation is a MISSION rule, not an ability chain. The Pattern E
    chain registry must remain discipline-pure."""
    dispatch.install_default_handlers()
    assert get_chain_handler('Fluctuation') is None
    assert get_chain_handler('Force Storm') is None
    assert get_chain_handler('fluctuation') is None
    assert 'Fluctuation' not in registered_chain_ids()
    assert 'Force Storm' not in registered_chain_ids()


def test_fluct_pattern_e_registry_post_d3_17():
    """Post-D3.17 the Pattern E registry has six entries: Force Push (D3.8),
    force_throw (D3.11), hop_on_kuiil (D3.13), wrist_cord (D3.15),
    mandalorian_whip (D3.15), and barrage_ct1701 (D3.17).
    force_throw/wrist_cord/mandalorian_whip share the generalized
    handle_push_target_within_range handler; barrage_ct1701 is a 4-phase
    state-flag mutator. All 349 other Pattern E ability IDs raise
    ChainNotImplemented. Fluctuation is correctly absent — it lives in the
    mission-rule module, not the Pattern E chain registry."""
    dispatch.install_default_handlers()
    registered = registered_chain_ids()
    expected = {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }
    assert set(registered) == expected, (
        f'Expected exactly {expected}, got: {registered}'
    )


def test_fluct_other_pattern_e_abilities_still_raise_chain_not_implemented():
    """Regression pin: verifies the fail-loud contract held by D3.8/D3.11/D3.13
    /D3.15/D3.17 for non-registered E-chains is not regressed by the D3.10
    mission-rule port."""
    from python.engine.abilities.classify import classify_ability
    from python.engine.data.ability_library_loader import get_ability_library

    dispatch.install_default_handlers()
    library = get_ability_library()
    registered = {
        'Force Push',
        'force_throw',
        'hop_on_kuiil',
        'wrist_cord',
        'mandalorian_whip',
        'barrage_ct1701',
    }
    checked = 0
    for ability_id, entry in library.items():
        pattern, _ = classify_ability(ability_id, entry)
        if pattern != 'E' or ability_id in registered:
            continue
        try:
            dispatch.resolve({}, ability_id, {})
            assert False, f'Expected ChainNotImplemented for {ability_id!r}'
        except ChainNotImplemented as e:
            assert e.ability_id == ability_id
            checked += 1
            if checked >= 3:
                return
    assert checked >= 1, 'Expected at least one unregistered Pattern E ability'


# ── Runner ──────────────────────────────────────────────────────────────────

def main():
    dispatch.install_default_handlers()

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
