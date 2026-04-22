"""Tests for the round Discord handler."""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class _User:
    def __init__(self, uid): self.id = uid


class _Interaction:
    def __init__(self, custom_id, user_id='alice'):
        self.custom_id = custom_id
        self.user = _User(user_id)


def _fresh_registry():
    from python.discord_bot import handlers
    from python.discord_bot.handlers import round as rd
    handlers.reset_for_tests()
    handlers.register('end_end_of_round_', rd._handle_end_end_of_round, 'round')
    handlers.register('end_start_of_round_', rd._handle_end_start_of_round, 'round')


def _two_figure_game(round_num=1):
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader._dc_effects = {
        'Rebel Trooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3, 'affiliation': 'Rebel',
        },
        'Stormtrooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3, 'affiliation': 'Imperial',
        },
    }
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'h8': ['h7']},
        'spaces': ['a1', 'a2', 'h7', 'h8'],
        'blocking': [], 'impassableEdges': [],
    }}
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['round'] = round_num
    g.data['roundPhase'] = 'end'
    g.data['activationsRemaining'] = {1: 0, 2: 0}
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {'Stormtrooper (Regular)-0-0': 'h8'},
    }
    return g


def _cleanup():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_end_end_of_round_advances_round():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game(round_num=1)
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_end_of_round_G1')
        result = handler(_Interaction('end_end_of_round_G1'), ctx)
        assert result['ok'] is True
        assert result['round'] == 2
        assert result['roundPhase'] == 'activation'
    finally:
        _cleanup()


def test_end_end_of_round_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('end_end_of_round_')
    result = handler(_Interaction('end_end_of_round_'), {'get_game': lambda g: None})
    # game_not_found because empty gameId
    assert result['ok'] is False


def test_end_start_of_round_closes_window():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_start_of_round_G1')
        result = handler(_Interaction('end_start_of_round_G1', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['startOfRoundWhoseTurn'] is None
    finally:
        _cleanup()


def test_end_start_of_round_rejects_non_sor_holder():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _two_figure_game()
    g.data['startOfRoundWhoseTurn'] = 'alice'
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_start_of_round_G1')
        result = handler(_Interaction('end_start_of_round_G1', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_sor_holder'
    finally:
        _cleanup()


def test_end_start_of_round_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('end_start_of_round_MISSING')
    result = handler(_Interaction('end_start_of_round_MISSING'),
                      {'get_game': lambda gid: None})
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('eor_advances_round', test_end_end_of_round_advances_round),
        ('eor_malformed', test_end_end_of_round_malformed),
        ('sor_closes_window', test_end_start_of_round_closes_window),
        ('sor_rejects_non_holder', test_end_start_of_round_rejects_non_sor_holder),
        ('sor_game_not_found', test_end_start_of_round_game_not_found),
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
            failures.append((name, e))
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
