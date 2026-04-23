"""Tests for game_lifecycle — the Discord-layer wrapper API.

Run: python3 python/discord_bot/test_game_lifecycle.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.game_lifecycle import (
    end_game,
    format_game_status,
    is_game_over,
    is_ready_to_play,
    new_game,
    setup_game,
)


def test_new_game_sets_players_and_lobby_phase():
    g = new_game('alice', 'bob')
    assert g.data['player1Id'] == 'alice'
    assert g.data['player2Id'] == 'bob'
    assert g.data['phase'] == 'lobby'
    assert not is_ready_to_play(g)
    assert not is_game_over(g)


def test_new_game_with_game_id():
    g = new_game('a', 'b', game_id='G-123')
    assert g.data['gameId'] == 'G-123'


def test_setup_game_runs_full_chain():
    g = new_game('alice', 'bob')
    g = setup_game(
        g,
        {'deploymentCards': ['Luke Skywalker']},
        {'deploymentCards': ['Stormtrooper (Regular)']},
        'mos-eisley-outskirts',
    )
    assert g.data['phase'] == 'round_active'
    assert g.data['roundPhase'] == 'activation'
    assert g.data.get('round') == 1
    assert is_ready_to_play(g)


def test_end_game_marks_terminal():
    g = new_game('alice', 'bob')
    g = end_game(g, winner=1, reason='elimination')
    assert g.data['phase'] == 'game_over'
    assert g.data['winner'] == 1
    assert g.data['gameEndedReason'] == 'elimination'
    assert is_game_over(g)
    assert not is_ready_to_play(g)


def test_end_game_is_idempotent():
    g = new_game('a', 'b')
    g = end_game(g, winner=1, reason='first')
    # Second call must not overwrite winner/reason.
    g = end_game(g, winner=2, reason='second')
    assert g.data['winner'] == 1
    assert g.data['gameEndedReason'] == 'first'


def test_format_game_status_after_setup():
    g = new_game('alice', 'bob')
    g = setup_game(
        g,
        {'deploymentCards': ['Luke Skywalker']},
        {'deploymentCards': ['Stormtrooper (Regular)']},
        'mos-eisley-outskirts',
    )
    st = format_game_status(g)
    assert st['phase'] == 'round_active'
    assert st['round'] == 1
    assert st['player1Id'] == 'alice'
    assert st['player2Id'] == 'bob'
    assert st['figureCount'][1] >= 1
    assert st['figureCount'][2] >= 1
    assert st['vp'] == {1: 0, 2: 0}
    assert st['winner'] is None


def test_format_game_status_after_end():
    g = new_game('a', 'b')
    g = end_game(g, winner=2, reason='VP win')
    st = format_game_status(g)
    assert st['phase'] == 'game_over'
    assert st['winner'] == 2
    assert st['gameEndedReason'] == 'VP win'


def main():
    cases = [
        ('new_game_basic', test_new_game_sets_players_and_lobby_phase),
        ('new_game_with_id', test_new_game_with_game_id),
        ('setup_game_full', test_setup_game_runs_full_chain),
        ('end_game', test_end_game_marks_terminal),
        ('end_game_idempotent', test_end_game_is_idempotent),
        ('status_after_setup', test_format_game_status_after_setup),
        ('status_after_end', test_format_game_status_after_end),
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
