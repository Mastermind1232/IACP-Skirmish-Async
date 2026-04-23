"""Tests for win_conditions — VP threshold + elimination + tiebreakers.

Run: python3 python/engine/mechanics/test_win_conditions.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.engine.mechanics.win_conditions import check_win_conditions


def _game(**extras):
    g = {
        'player1VP': {'total': 0, 'kills': 0},
        'player2VP': {'total': 0, 'kills': 0},
        'figurePositions': {1: {'A-1-0': 'a1'}, 2: {'B-1-0': 'a2'}},
    }
    g.update(extras)
    return g


def test_ongoing_game_returns_false():
    g = _game()
    g['player1VP']['total'] = 10
    r = check_win_conditions(g)
    assert r['ended'] is False
    assert g.get('phase') is None


def test_vp_40_wins_outright():
    g = _game()
    g['player1VP']['total'] = 42
    g['player2VP']['total'] = 30
    r = check_win_conditions(g)
    assert r['ended'] is True
    assert r['winner'] == 1
    assert '40 VP' in r['reason']
    assert g['phase'] == 'game_over'


def test_both_40_higher_vp_wins():
    g = _game()
    g['player1VP']['total'] = 43
    g['player2VP']['total'] = 45
    r = check_win_conditions(g)
    assert r['winner'] == 2
    assert '40 VP' in r['reason']


def test_vp_tied_kill_vp_tiebreaker():
    g = _game()
    g['player1VP']['total'] = 40
    g['player1VP']['kills'] = 30
    g['player2VP']['total'] = 40
    g['player2VP']['kills'] = 20
    r = check_win_conditions(g)
    assert r['winner'] == 1
    assert 'kill VP' in r['reason']


def test_vp_tied_damage_tiebreaker():
    g = _game()
    g['player1VP']['total'] = 40
    g['player1VP']['kills'] = 20
    g['player2VP']['total'] = 40
    g['player2VP']['kills'] = 20
    g['totalDamageReceived'] = {1: 50, 2: 30}
    r = check_win_conditions(g)
    # Lower damage wins → P2 (30 vs 50).
    assert r['winner'] == 2
    assert 'damage received' in r['reason']


def test_elimination_one_side():
    g = _game(figurePositions={1: {'A-1-0': 'a1'}, 2: {}})
    r = check_win_conditions(g)
    assert r['winner'] == 1
    assert r['reason'] == 'elimination'


def test_elimination_both_sides_draw():
    g = _game(figurePositions={1: {}, 2: {}})
    r = check_win_conditions(g)
    assert r['winner'] is None
    assert 'draw' in r['reason']


def test_idempotent_when_already_game_over():
    g = _game()
    g['phase'] = 'game_over'
    g['winner'] = 2
    g['gameEndedReason'] = 'elimination'
    # No VP or figures — should NOT re-stamp based on fresh state.
    r = check_win_conditions(g)
    assert r['ended'] is True
    assert r['winner'] == 2


def main():
    cases = [
        ('ongoing', test_ongoing_game_returns_false),
        ('vp40_outright', test_vp_40_wins_outright),
        ('both_40_higher_wins', test_both_40_higher_vp_wins),
        ('tied_kill_tiebreak', test_vp_tied_kill_vp_tiebreaker),
        ('tied_dmg_tiebreak', test_vp_tied_damage_tiebreaker),
        ('elim_one_side', test_elimination_one_side),
        ('elim_both_draw', test_elimination_both_sides_draw),
        ('idempotent', test_idempotent_when_already_game_over),
    ]
    failures = []
    for name, fn in cases:
        try:
            fn()
            print(f'PASS: {name}')
        except Exception as e:
            import traceback
            print(f'FAIL: {name}: {e}')
            traceback.print_exc()
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
