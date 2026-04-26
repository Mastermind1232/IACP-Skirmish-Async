"""P2.4 + P2.5 verification: round flow engine.

Tests cover run_start_of_round, run_end_of_round, and
run_start_of_round_dc_effects.
"""
from python.engine.round import (
    run_end_of_round,
    run_start_of_round,
    run_start_of_round_dc_effects,
)


def _game(round_=1, p1_id='p1', p2_id='p2', init_id='p1', extra=None):
    g = {
        'currentRound': round_,
        'round': round_,
        'player1Id': p1_id,
        'player2Id': p2_id,
        'initiativePlayerId': init_id,
        'p1DcList': [],
        'p2DcList': [],
        'p1DcMessageIds': [],
        'p2DcMessageIds': [],
        'figurePositions': {1: {}, 2: {}},
        'roundPhase': 'activation',
    }
    if extra:
        g.update(extra)
    return g


# ── run_start_of_round ──────────────────────────────────────────────────


def test_start_of_round_increments_counter():
    g = _game(round_=1)
    result = run_start_of_round(g)
    assert g['currentRound'] == 2
    assert g['round'] == 2
    assert result['currentRound'] == 2


def test_start_of_round_swaps_initiative():
    g = _game(p1_id='p1', p2_id='p2', init_id='p1')
    run_start_of_round(g)
    assert g['initiativePlayerId'] == 'p2'


def test_start_of_round_resets_round_flags():
    g = _game(extra={
        'roundDefenseBonusBlock': {'X-1-0': 2},
        'phaseGate': {'phase': 'pre_end_of_round'},
        'pendingNegation': {'card': 'X'},
    })
    run_start_of_round(g)
    # Round-scoped object flags reset to {}.
    assert g['roundDefenseBonusBlock'] == {}
    # Round-scoped null flags reset to None.
    assert g['phaseGate'] is None
    assert g['pendingNegation'] is None


def test_start_of_round_resets_round_phase_to_activation():
    g = _game(extra={'roundPhase': 'end_of_round'})
    run_start_of_round(g)
    assert g['roundPhase'] == 'activation'


def test_start_of_round_resets_activation_counts_from_live_groups():
    """Both players have 2 groups → both p1ActivationsRemaining and
    p2ActivationsRemaining = 2."""
    g = _game(extra={
        'figurePositions': {
            1: {'Han-1-0': 'a13', 'Chewie-1-0': 'a12'},
            2: {'Boba-1-0': 'a14', 'Stormtrooper-1-0': 'b13', 'Stormtrooper-1-1': 'b14'},
        },
    })
    run_start_of_round(g)
    # P1: 2 distinct groups (Han-1, Chewie-1).
    assert g['p1ActivationsRemaining'] == 2
    # P2: 2 distinct groups (Boba-1, Stormtrooper-1).
    assert g['p2ActivationsRemaining'] == 2
    # Activated indices reset.
    assert g['p1ActivatedDcIndices'] == []
    assert g['p2ActivatedDcIndices'] == []


def test_start_of_round_clears_dead_groups_from_count():
    """Defeated DC (no figures left) doesn't count toward activations."""
    g = _game(extra={
        'figurePositions': {
            1: {'Han-1-0': 'a13'},  # only 1 group alive
            2: {},
        },
    })
    run_start_of_round(g)
    assert g['p1ActivationsRemaining'] == 1
    assert g['p2ActivationsRemaining'] == 0


# ── run_end_of_round ────────────────────────────────────────────────────


def test_end_of_round_sets_round_phase_end_of_round():
    g = _game()
    run_end_of_round(g)
    assert g['roundPhase'] == 'end_of_round'


def test_end_of_round_sets_endofround_whose_turn():
    """endOfRoundWhoseTurn is the initiative player."""
    g = _game(p1_id='p1', p2_id='p2', init_id='p2')
    run_end_of_round(g)
    assert g['endOfRoundWhoseTurn'] == 'p2'


def test_end_of_round_does_not_increment_counter():
    """Round counter advances at start_of_round, not end_of_round."""
    g = _game(round_=3)
    run_end_of_round(g)
    assert g['currentRound'] == 3


def test_end_of_round_does_not_swap_initiative():
    """Initiative swap happens at start_of_round (next round), not now."""
    g = _game(p1_id='p1', p2_id='p2', init_id='p1')
    run_end_of_round(g)
    assert g['initiativePlayerId'] == 'p1'


# ── DC start-of-round passives ──────────────────────────────────────────


def test_dc_sor_effects_returns_empty_when_no_dcs():
    g = _game()
    triggered = run_start_of_round_dc_effects(g)
    assert triggered == []


def test_dc_sor_effects_self_destruct_probe_round_2():
    """self_destruct_probe arms at round 2+."""
    g = _game(round_=2, extra={
        'p1DcList': [{'dcName': 'Saboteur Probe Droid', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
    })
    # Mock dc_effects to include self_destruct_probe.
    from unittest.mock import patch
    fake = {
        'Saboteur Probe Droid': {'specialAbilityIds': ['self_destruct_probe']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake,
    ):
        triggered = run_start_of_round_dc_effects(g)
    sdp = [t for t in triggered if t.get('effect') == 'self_destruct_probe']
    assert len(sdp) == 1


def test_dc_sor_effects_self_destruct_probe_skipped_round_1():
    """self_destruct_probe does NOT fire at round 1."""
    g = _game(round_=1, extra={
        'p1DcList': [{'dcName': 'Saboteur Probe Droid', 'dgIndex': 1}],
        'p1DcMessageIds': ['hl1dc0'],
    })
    from unittest.mock import patch
    fake = {
        'Saboteur Probe Droid': {'specialAbilityIds': ['self_destruct_probe']},
    }
    with patch(
        'python.engine.data.dc_effects_loader.get_dc_effects',
        return_value=fake,
    ):
        triggered = run_start_of_round_dc_effects(g)
    sdp = [t for t in triggered if t.get('effect') == 'self_destruct_probe']
    assert sdp == []


# ── Full round-cycle smoke ──────────────────────────────────────────────


def test_round_cycle_end_then_start():
    """End round 1 → start round 2: counter goes 1 → 2, initiative swaps,
    round flags reset."""
    g = _game(round_=1, p1_id='p1', p2_id='p2', init_id='p1', extra={
        'roundDefenseBonusBlock': {'X': 1},
        'phaseGate': {'phase': 'pre_end_of_round'},
    })
    run_end_of_round(g)
    assert g['roundPhase'] == 'end_of_round'
    # Round flags still present (cleanup happens at next round start).
    assert g['roundDefenseBonusBlock'] == {'X': 1}

    run_start_of_round(g)
    assert g['currentRound'] == 2
    assert g['initiativePlayerId'] == 'p2'  # swapped
    assert g['roundDefenseBonusBlock'] == {}  # reset
    assert g['phaseGate'] is None  # reset
    assert g['roundPhase'] == 'activation'
