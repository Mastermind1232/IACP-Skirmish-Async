"""Unit tests for the D2.29 pure-engine defeat pipeline.

Exercises the exported surface of `python.engine.mechanics.defeat`:
  - remove_figure_position (position + deviceTokens + figureConditions)
  - ensure_vp / award_kill_vp / award_objective_vp / deduct_vp
  - check_nefarious_gains (Jabba alive check)
  - calculate_kill_vp (companion=0, subCost, default=5)
  - recompute_activation_counts (figure-presence derivation)
  - process_figure_defeat (pure-engine 9-step orchestrator)

The behavioral oracle tests in tests/domain/oracle/defeat-pipeline-behavioral.test.js
and group-defeat-activation-probes.test.js depend on createTestGame() fixture
(full D1 state + D4 cards + deps wiring) — those port later once the fixture
builder lands.

Run as: python3 -m python.parity.oracles.combat.test_defeat_pipeline_engine
"""
import sys

from python.engine.mechanics.defeat import (
    award_kill_vp,
    award_objective_vp,
    calculate_kill_vp,
    check_nefarious_gains,
    deduct_vp,
    ensure_vp,
    process_figure_defeat,
    recompute_activation_counts,
    remove_figure_position,
)


# ── remove_figure_position ──────────────────────────────────────────────────

def test_remove_position_clears_position():
    game = {'figurePositions': {1: {'A-1-0': 'AA1'}, 2: {}}}
    remove_figure_position(game, 1, 'A-1-0')
    assert 'A-1-0' not in game['figurePositions'][1]


def test_remove_position_clears_device_tokens():
    game = {
        'figurePositions': {1: {'A-1-0': 'AA1'}, 2: {}},
        'deviceTokens': {'A-1-0': ['bleed'], 'B-1-0': ['focus']},
    }
    remove_figure_position(game, 1, 'A-1-0')
    assert 'A-1-0' not in game['deviceTokens']
    assert game['deviceTokens']['B-1-0'] == ['focus']


def test_remove_position_clears_conditions():
    game = {
        'figurePositions': {1: {'A-1-0': 'AA1'}, 2: {}},
        'figureConditions': {'A-1-0': ['Stun']},
    }
    remove_figure_position(game, 1, 'A-1-0')
    assert 'A-1-0' not in game['figureConditions']


def test_remove_position_is_defensive_on_missing_state():
    game = {}
    remove_figure_position(game, 1, 'Ghost-0-0')  # should not raise


# ── ensure_vp / award / deduct ──────────────────────────────────────────────

def test_ensure_vp_creates_default_shape():
    game = {}
    vp = ensure_vp(game, 1)
    assert vp == {'total': 0, 'kills': 0, 'objectives': 0}
    assert game['player1VP'] is vp


def test_ensure_vp_returns_existing():
    existing = {'total': 5, 'kills': 3, 'objectives': 2}
    game = {'player2VP': existing}
    vp = ensure_vp(game, 2)
    assert vp is existing


def test_award_kill_vp_increments_kills_and_total():
    game = {}
    award_kill_vp(game, 1, 3)
    assert game['player1VP'] == {'total': 3, 'kills': 3, 'objectives': 0}


def test_award_objective_vp_increments_objectives_and_total():
    game = {}
    award_objective_vp(game, 2, 4)
    assert game['player2VP'] == {'total': 4, 'kills': 0, 'objectives': 4}


def test_deduct_vp_objectives_first_then_kills():
    game = {'player1VP': {'total': 10, 'kills': 7, 'objectives': 3}}
    deduct_vp(game, 1, 5)
    # 3 objectives first, then 2 from kills
    assert game['player1VP']['objectives'] == 0
    assert game['player1VP']['kills'] == 5
    assert game['player1VP']['total'] == 5


def test_deduct_vp_clamps_at_zero():
    game = {'player1VP': {'total': 2, 'kills': 1, 'objectives': 1}}
    deduct_vp(game, 1, 10)
    assert game['player1VP']['total'] == 0


# ── check_nefarious_gains ───────────────────────────────────────────────────

def test_nefarious_gains_fires_when_jabba_alive_on_opposite_side():
    game = {
        'figurePositions': {
            1: {'Jabba the Hutt-1-0': 'CC5'},
            2: {'Trooper-1-0': 'CC3'},
        },
    }
    # P2's Trooper was defeated → check for Jabba on P1
    res = check_nefarious_gains(game, 2)
    assert res is not None
    assert res['jabbaOwnerPN'] == 1
    assert res['vpTotal'] == 1
    assert game['player1VP']['objectives'] == 1


def test_nefarious_gains_noop_when_jabba_not_on_board():
    game = {
        'figurePositions': {
            1: {'Stormtrooper (Regular)-1-0': 'AA1'},
            2: {'Trooper-1-0': 'CC3'},
        },
    }
    res = check_nefarious_gains(game, 2)
    assert res is None
    assert 'player1VP' not in game


def test_nefarious_gains_ignores_dead_jabba():
    # Jabba in figurePositions gets REMOVED on defeat; absence = dead.
    game = {'figurePositions': {1: {}, 2: {'T-1-0': 'CC1'}}}
    assert check_nefarious_gains(game, 2) is None


# ── calculate_kill_vp ───────────────────────────────────────────────────────

def test_calculate_kill_vp_uses_dc_cost():
    # Stormtrooper (Regular) is a 3-figure group with subCost; Regular cost=6.
    # Use a well-known example from data: Boba Fett cost = 15.
    # We rely on real dc-effects.json here.
    vp = calculate_kill_vp('Boba Fett')
    assert vp > 0, 'Boba Fett should have a positive VP value'


def test_calculate_kill_vp_uses_subcost_for_multi_figure_groups():
    # Stormtrooper (Regular): 3 figures, subCost = 2 (per-figure kill value).
    vp = calculate_kill_vp('Stormtrooper (Regular)')
    assert vp == 2, f'Stormtrooper (Regular) per-kill should be subCost=2, got {vp}'


def test_calculate_kill_vp_unknown_dc_defaults_to_5():
    vp = calculate_kill_vp('Definitely Not A Real DC Name')
    assert vp == 5, 'unknown DC falls back to 5 per JS ?? 5 default'


# ── recompute_activation_counts ─────────────────────────────────────────────

def test_recompute_activation_counts_counts_dc_with_figures():
    game = {
        'p1DcList': [{'dcName': 'Trooper'}, {'dcName': 'Officer'}],
        'figurePositions': {
            1: {'Trooper-1-0': 'A1', 'Trooper-1-1': 'A2', 'Officer-1-0': 'B1'},
        },
        'p1ActivatedDcIndices': [],
    }
    r = recompute_activation_counts(game, 1)
    assert r == {'total': 2, 'remaining': 2}


def test_recompute_activation_counts_excludes_dc_with_no_figures():
    game = {
        'p1DcList': [{'dcName': 'Trooper'}, {'dcName': 'Ghost'}],
        'figurePositions': {1: {'Trooper-1-0': 'A1'}},
        'p1ActivatedDcIndices': [],
    }
    r = recompute_activation_counts(game, 1)
    assert r == {'total': 1, 'remaining': 1}


def test_recompute_activation_counts_subtracts_activated():
    game = {
        'p1DcList': [{'dcName': 'A'}, {'dcName': 'B'}, {'dcName': 'C'}],
        'figurePositions': {
            1: {'A-1-0': 'P1', 'B-1-0': 'P2', 'C-1-0': 'P3'},
        },
        'p1ActivatedDcIndices': [0, 2],  # A and C activated
    }
    r = recompute_activation_counts(game, 1)
    assert r == {'total': 3, 'remaining': 1}


def test_recompute_activation_counts_skips_bracketed_names():
    game = {
        'p1DcList': [{'dcName': 'A'}, {'dcName': '[Figureless]'}],
        'figurePositions': {1: {'A-1-0': 'P1'}},
        'p1ActivatedDcIndices': [],
    }
    r = recompute_activation_counts(game, 1)
    assert r == {'total': 1, 'remaining': 1}


def test_recompute_activation_counts_handles_duplicate_dc_groups():
    # Two Stormtrooper groups (dg=1 and dg=2).
    game = {
        'p1DcList': [
            {'dcName': 'Stormtrooper (Regular)'},
            {'dcName': 'Stormtrooper (Regular)'},
        ],
        'figurePositions': {
            1: {
                'Stormtrooper (Regular)-1-0': 'A1',
                'Stormtrooper (Regular)-2-0': 'B1',
            },
        },
        'p1ActivatedDcIndices': [],
    }
    r = recompute_activation_counts(game, 1)
    assert r == {'total': 2, 'remaining': 2}


def test_recompute_activation_counts_full_group_wipe_drops_count():
    # All figures of a group removed → that group no longer counts.
    game = {
        'p1DcList': [{'dcName': 'A'}, {'dcName': 'B'}],
        'figurePositions': {1: {'A-1-0': 'P1'}},  # B has no figures
        'p1ActivatedDcIndices': [0, 1],  # both activated
    }
    r = recompute_activation_counts(game, 1)
    # Only A counts now; A is activated → remaining=0.
    assert r == {'total': 1, 'remaining': 0}


# ── process_figure_defeat orchestrator ──────────────────────────────────────

def test_process_defeat_removes_position_and_awards_vp():
    game = {
        'p2DcList': [{'dcName': 'Stormtrooper (Regular)'}],
        'figurePositions': {
            1: {'Boba Fett-1-0': 'A1'},
            2: {
                'Stormtrooper (Regular)-1-0': 'X1',
                'Stormtrooper (Regular)-1-1': 'X2',
                'Stormtrooper (Regular)-1-2': 'X3',
            },
        },
        'p2ActivatedDcIndices': [],
    }
    r = process_figure_defeat(game, {
        'defeatedPlayerNum': 2,
        'figureKey': 'Stormtrooper (Regular)-1-0',
        'attackerPlayerNum': 1,
        'msgId': 'msg1',
        'dcIdx': 0,
    })
    assert r['dcName'] == 'Stormtrooper (Regular)'
    assert r['vp'] == 2  # subCost
    assert 'Stormtrooper (Regular)-1-0' not in game['figurePositions'][2]
    assert game['player1VP']['kills'] == 2
    # 2 of 3 figures alive → activation still counts
    assert game['p2ActivationsTotal'] == 1
    assert game['p2ActivationsRemaining'] == 1


def test_process_defeat_last_in_group_drops_activation():
    game = {
        'p2DcList': [{'dcName': 'Officer'}, {'dcName': 'Trooper'}],
        'figurePositions': {
            1: {},
            2: {'Officer-1-0': 'A1', 'Trooper-1-0': 'B1'},
        },
        'p2ActivatedDcIndices': [],
    }
    process_figure_defeat(game, {
        'defeatedPlayerNum': 2,
        'figureKey': 'Officer-1-0',
        'attackerPlayerNum': 1,
    })
    assert game['p2ActivationsTotal'] == 1  # only Trooper remains
    assert game['p2ActivationsRemaining'] == 1


def test_process_defeat_nefarious_gains_fires_when_jabba_alive():
    game = {
        'p2DcList': [{'dcName': 'Trooper'}],
        'figurePositions': {
            1: {'Jabba the Hutt-1-0': 'Z1'},
            2: {'Trooper-1-0': 'X1'},
        },
        'p2ActivatedDcIndices': [],
    }
    r = process_figure_defeat(game, {
        'defeatedPlayerNum': 2,
        'figureKey': 'Trooper-1-0',
        'attackerPlayerNum': 1,
    })
    assert r['nefarious'] is not None
    assert r['nefarious']['jabbaOwnerPN'] == 1
    assert game['player1VP']['objectives'] == 1


def test_process_defeat_award_vp_false_skips_vp_award():
    game = {
        'p2DcList': [{'dcName': 'Officer'}],
        'figurePositions': {1: {}, 2: {'Officer-1-0': 'A1'}},
        'p2ActivatedDcIndices': [],
    }
    r = process_figure_defeat(game, {
        'defeatedPlayerNum': 2,
        'figureKey': 'Officer-1-0',
        'attackerPlayerNum': 1,
        'awardVp': False,
    })
    assert r['vp'] == 0
    assert 'player1VP' not in game


def test_process_defeat_clears_cc_attachments():
    game = {
        'p2DcList': [{'dcName': 'Officer'}],
        'figurePositions': {1: {}, 2: {'Officer-1-0': 'A1'}},
        'p2ActivatedDcIndices': [],
        'p2CcAttachments': {'msg1': ['Heroic Effort']},
    }
    process_figure_defeat(game, {
        'defeatedPlayerNum': 2,
        'figureKey': 'Officer-1-0',
        'attackerPlayerNum': 1,
        'msgId': 'msg1',
        'dcIdx': 0,
    })
    assert 'msg1' not in game['p2CcAttachments']


def test_process_defeat_invokes_check_win_callback_when_provided():
    calls = []
    game = {
        'p2DcList': [{'dcName': 'Officer'}],
        'figurePositions': {1: {}, 2: {'Officer-1-0': 'A1'}},
        'p2ActivatedDcIndices': [],
    }
    process_figure_defeat(
        game,
        {'defeatedPlayerNum': 2, 'figureKey': 'Officer-1-0', 'attackerPlayerNum': 1},
        deps={'checkWinConditions': lambda g: calls.append(g)},
    )
    assert len(calls) == 1


def test_process_defeat_skips_win_conditions_when_opts_flag_set():
    calls = []
    game = {
        'p2DcList': [{'dcName': 'Officer'}],
        'figurePositions': {1: {}, 2: {'Officer-1-0': 'A1'}},
        'p2ActivatedDcIndices': [],
    }
    process_figure_defeat(
        game,
        {
            'defeatedPlayerNum': 2,
            'figureKey': 'Officer-1-0',
            'attackerPlayerNum': 1,
            'skipWinConditions': True,
        },
        deps={'checkWinConditions': lambda g: calls.append(g)},
    )
    assert len(calls) == 0


def test_process_defeat_invokes_hunt_dissent_callback_when_attacker_key_provided():
    calls = []
    game = {
        'p2DcList': [{'dcName': 'Officer'}],
        'figurePositions': {1: {}, 2: {'Officer-1-0': 'A1'}},
        'p2ActivatedDcIndices': [],
    }
    process_figure_defeat(
        game,
        {
            'defeatedPlayerNum': 2,
            'figureKey': 'Officer-1-0',
            'attackerPlayerNum': 1,
            'attackerFigureKey': 'Agent Kallus-1-0',
        },
        deps={'checkHuntDissent': lambda g, pn, fk: calls.append((pn, fk))},
    )
    assert calls == [(1, 'Agent Kallus-1-0')]


ALL_TESTS = [
    test_remove_position_clears_position,
    test_remove_position_clears_device_tokens,
    test_remove_position_clears_conditions,
    test_remove_position_is_defensive_on_missing_state,
    test_ensure_vp_creates_default_shape,
    test_ensure_vp_returns_existing,
    test_award_kill_vp_increments_kills_and_total,
    test_award_objective_vp_increments_objectives_and_total,
    test_deduct_vp_objectives_first_then_kills,
    test_deduct_vp_clamps_at_zero,
    test_nefarious_gains_fires_when_jabba_alive_on_opposite_side,
    test_nefarious_gains_noop_when_jabba_not_on_board,
    test_nefarious_gains_ignores_dead_jabba,
    test_calculate_kill_vp_uses_dc_cost,
    test_calculate_kill_vp_uses_subcost_for_multi_figure_groups,
    test_calculate_kill_vp_unknown_dc_defaults_to_5,
    test_recompute_activation_counts_counts_dc_with_figures,
    test_recompute_activation_counts_excludes_dc_with_no_figures,
    test_recompute_activation_counts_subtracts_activated,
    test_recompute_activation_counts_skips_bracketed_names,
    test_recompute_activation_counts_handles_duplicate_dc_groups,
    test_recompute_activation_counts_full_group_wipe_drops_count,
    test_process_defeat_removes_position_and_awards_vp,
    test_process_defeat_last_in_group_drops_activation,
    test_process_defeat_nefarious_gains_fires_when_jabba_alive,
    test_process_defeat_award_vp_false_skips_vp_award,
    test_process_defeat_clears_cc_attachments,
    test_process_defeat_invokes_check_win_callback_when_provided,
    test_process_defeat_skips_win_conditions_when_opts_flag_set,
    test_process_defeat_invokes_hunt_dissent_callback_when_attacker_key_provided,
]


def _main() -> int:
    failures = 0
    for t in ALL_TESTS:
        try:
            t()
            print(f'PASS  {t.__name__}')
        except AssertionError as e:
            failures += 1
            print(f'FAIL  {t.__name__}: {e}')
        except Exception as e:
            failures += 1
            print(f'ERROR {t.__name__}: {type(e).__name__}: {e}')
    total = len(ALL_TESTS)
    print(f'\n{total - failures}/{total} passed')
    return 0 if failures == 0 else 1


if __name__ == '__main__':
    sys.exit(_main())
