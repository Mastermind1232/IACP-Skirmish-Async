"""Tests for the activation Discord handler."""
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
    from python.discord_bot.handlers import activation as act
    handlers.reset_for_tests()
    handlers.register('activate_dc_', act._handle_activate_dc, 'activation')
    handlers.register('pass_activation_turn_', act._handle_pass_activation_turn, 'activation')
    handlers.register('end_activation_phase_', act._handle_end_activation_phase, 'activation')
    handlers.register('dc_end_activation_', act._handle_dc_end_activation, 'activation')
    handlers.register('end_turn_', act._handle_end_turn, 'activation')


def _game_with_rebel_trooper(round_phase='activation'):
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader._dc_effects = {
        'Rebel Trooper (Regular)': {
            'figures': 3, 'speed': 4, 'health': 3, 'cost': 3,
            'affiliation': 'Rebel',
        },
    }
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'a2': ['a1']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [],
    }}
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['phase'] = 'round_active'
    g.data['roundPhase'] = round_phase
    g.data['activePlayer'] = 1
    g.data['activationsRemaining'] = {1: 1, 2: 1}
    g.data['activeFigureKeys'] = []
    g.data['figurePositions'] = {
        1: {'Rebel Trooper (Regular)-0-0': 'a1'},
        2: {},
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Rebel Trooper (Regular)', 'dgIndex': 0}]
    return g


def _cleanup():
    from python.engine.data import dc_effects_loader, map_spaces_loader
    dc_effects_loader.reset_cache()
    map_spaces_loader.reset_cache()


def test_activate_dc_happy_path():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('activate_dc_G1_hl1dc0_0')
        result = handler(_Interaction('activate_dc_G1_hl1dc0_0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['playerNum'] == 1
        assert 'Rebel Trooper' in result['dcName']
        assert result['game'].data['activeFigureKeys']
    finally:
        _cleanup()


def test_activate_dc_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('activate_dc_G1_hl1dc0_0')
        result = handler(_Interaction('activate_dc_G1_hl1dc0_0', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner_of_dc'
    finally:
        _cleanup()


def test_activate_dc_malformed_custom_id():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('activate_dc_nope')
    result = handler(_Interaction('activate_dc_nope'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_pass_activation_turn_swaps_active_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('pass_activation_turn_G1')
        result = handler(_Interaction('pass_activation_turn_G1', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_activation_phase_transitions_round():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activationsRemaining'] = {1: 0, 2: 0}
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_activation_phase_G1')
        result = handler(_Interaction('end_activation_phase_G1'), ctx)
        assert result['ok'] is True
    finally:
        _cleanup()


def test_dc_end_activation_clears_active_and_swaps():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
        g.data['movementPoints'] = 3
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('dc_end_activation_G1_hl1dc0')
        result = handler(_Interaction('dc_end_activation_G1_hl1dc0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['activeFigureKeys'] == []
        assert result['game'].data['movementPoints'] == 0
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_turn_clears_pending_and_ends_activation():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        g.data['activeFigureKeys'] = ['Rebel Trooper (Regular)-0-0']
        g.data['pendingEndTurn'] = {'hl1dc0': {'displayName': 'Rebel Trooper'}}
        g.data['movementBank'] = {'hl1dc0': {'total': 4, 'remaining': 2}}
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_turn_G1_hl1dc0')
        result = handler(_Interaction('end_turn_G1_hl1dc0', user_id='alice'), ctx)
        assert result['ok'] is True
        assert result['game'].data['pendingEndTurn'] is None
        assert result['game'].data['movementBank'] is None
        assert result['game'].data['activePlayer'] == 2
    finally:
        _cleanup()


def test_end_turn_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_rebel_trooper()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('end_turn_G1_hl1dc0')
        result = handler(_Interaction('end_turn_G1_hl1dc0', user_id='bob'), ctx)
        assert result['ok'] is False
        assert result['reason'] == 'not_owner_of_dc'
    finally:
        _cleanup()


def main():
    cases = [
        ('activate_dc_happy', test_activate_dc_happy_path),
        ('activate_dc_rejects_non_owner', test_activate_dc_rejects_non_owner),
        ('activate_dc_malformed', test_activate_dc_malformed_custom_id),
        ('pass_activation_swaps', test_pass_activation_turn_swaps_active_player),
        ('end_activation_phase_transitions', test_end_activation_phase_transitions_round),
        ('dc_end_activation_clears_and_swaps', test_dc_end_activation_clears_active_and_swaps),
        ('end_turn_clears_pending', test_end_turn_clears_pending_and_ends_activation),
        ('end_turn_rejects_non_owner', test_end_turn_rejects_non_owner),
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
