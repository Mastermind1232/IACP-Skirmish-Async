"""P2.6 verification: mission_rules entry points end-to-end smoke.

Validates run_start_of_round_rules + run_end_of_round_rules execute
without crashing for each supported map ID, and that win-condition
state stays consistent. Detailed VP-award math is covered by per-map
tests; this is the integration smoke that catches regressions across
the full mission set.
"""
import pytest

from python.engine.mechanics.mission_rules import (
    get_current_fluctuation_positions,
    run_end_of_round_rules,
    run_start_of_round_rules,
)


SUPPORTED_MAPS = [
    'mos-eisley-outskirts',
    'corellian-underground',
    'chopper-base-atollon',
    'lothal-wastes',
    'development-facility',
    'devaron-garrison',
    'anchorhead-cantina-bar',
    'hoth-battle-station',
]


def _game(round_=1):
    return {
        'currentRound': round_,
        'round': round_,
        'player1Id': 'p1',
        'player2Id': 'p2',
        'initiativePlayerId': 'p1',
        'figurePositions': {1: {}, 2: {}},
        'roundPhase': 'activation',
        'player1VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'player2VP': {'total': 0, 'kills': 0, 'objectives': 0},
        'p1DcList': [],
        'p2DcList': [],
        'p1DcMessageIds': [],
        'p2DcMessageIds': [],
    }


# ── Smoke: each map's start + end rules execute cleanly ─────────────────


@pytest.mark.parametrize('map_id', SUPPORTED_MAPS)
def test_run_start_of_round_rules_does_not_crash(map_id):
    g = _game()
    # Empty rules dict — exercises the early-out path. May return
    # None (no-op) or a dict.
    run_start_of_round_rules(g, map_id, 'a', {})
    # Survives without crashing.


@pytest.mark.parametrize('map_id', SUPPORTED_MAPS)
def test_run_end_of_round_rules_does_not_crash(map_id):
    g = _game()
    result = run_end_of_round_rules(g, map_id, 'a', {})
    assert isinstance(result, dict)
    assert 'gameEnded' in result
    assert result['gameEnded'] is False


@pytest.mark.parametrize('map_id', SUPPORTED_MAPS)
def test_run_end_of_round_rules_with_none_rules(map_id):
    """None rules dict is a valid no-op."""
    g = _game()
    result = run_end_of_round_rules(g, map_id, 'a', None)
    assert result == {'gameEnded': False}


# ── vpForControllingNamedArea: Anchorhead Cantina Bar ──────────────────


def test_vp_for_controlling_named_area_no_controller_yields_no_vp():
    g = _game()
    rules = {'vpForControllingNamedArea': {'areaName': 'cantina', 'vp': 1}}
    run_end_of_round_rules(g, 'anchorhead-cantina-bar', 'a', rules)
    # No controller because empty board.
    assert g['player1VP']['total'] == 0
    assert g['player2VP']['total'] == 0


# ── Fluctuation: get_current_fluctuation_positions ─────────────────────


def test_get_current_fluctuation_positions_handles_missing_data():
    g = _game()
    # No fluctuation tokens stamped; should return empty / None safely.
    result = get_current_fluctuation_positions(g, None, 'a')
    assert result is None or isinstance(result, (list, dict))


# ── Integration: round 1 start + round 1 end smoke ─────────────────────


@pytest.mark.parametrize('map_id', SUPPORTED_MAPS)
def test_round_one_start_then_end_no_crash(map_id):
    """Pipeline smoke: start-of-round → activation phase → end-of-round
    runs cleanly for every map."""
    g = _game(round_=1)
    rules = {}  # empty mission rules — pure orchestrator smoke
    run_start_of_round_rules(g, map_id, 'a', rules)
    assert g['roundPhase'] == 'activation'
    result = run_end_of_round_rules(g, map_id, 'a', rules)
    assert result['gameEnded'] is False
    # VP state remains valid shape.
    assert isinstance(g['player1VP'], dict)
    assert isinstance(g['player2VP'], dict)
