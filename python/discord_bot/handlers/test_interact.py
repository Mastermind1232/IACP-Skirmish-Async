"""Tests for the interact Discord handler."""
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
    from python.discord_bot.handlers import interact as it
    handlers.reset_for_tests()
    handlers.register('interact_choice_', it._handle_interact, 'core')


def _game_with_door():
    """Build a game with a map that has a door between a1↔a2 for interact."""
    from python.engine.creation import create_game
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    # Monkeypatch loaders for this test
    map_spaces_loader._map_spaces = {'utest': {
        'adjacency': {'a1': ['a2'], 'a2': ['a1']},
        'spaces': ['a1', 'a2'],
        'blocking': [], 'impassableEdges': [], 'movementBlockingEdges': [],
    }}
    map_tokens_loader._cache = {'utest': {
        'terminals': [], 'doors': [['a1', 'a2']],
    }}
    dc_effects_loader._dc_effects = {
        'Luke Skywalker': {'figures': 1, 'speed': 4},
    }

    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['mapId'] = 'utest'
    g.data['selectedMap'] = {'id': 'utest'}
    g.data['figurePositions'] = {
        1: {'Luke Skywalker-1-0': 'a1'},
        2: {},
    }
    g.data['p1DcMessageIds'] = ['hl1dc0']
    g.data['p1DcList'] = [{'dcName': 'Luke Skywalker', 'displayName': 'Luke Skywalker'}]
    return g


def _cleanup():
    from python.engine.data import map_spaces_loader, map_tokens_loader, dc_effects_loader
    map_spaces_loader.reset_cache()
    map_tokens_loader.reset_cache()
    dc_effects_loader.reset_cache()


def test_interact_happy_path_opens_door():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_door()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('interact_choice_G1_hl1dc0_0_open_door_a1|a2')
        result = handler(
            _Interaction('interact_choice_G1_hl1dc0_0_open_door_a1|a2',
                          user_id='alice'), ctx,
        )
        assert result['ok'] is True
        assert result['optionId'] == 'open_door_a1|a2'
        # Door was opened
        assert 'a1|a2' in (result['game'].data.get('openedDoors') or [])
    finally:
        _cleanup()


def test_interact_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_door()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('interact_choice_G1_hl1dc0_0_open_door_a1|a2')
        # P1's figure, but caller is bob (player2)
        result = handler(
            _Interaction('interact_choice_G1_hl1dc0_0_open_door_a1|a2',
                          user_id='bob'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'not_owner'
    finally:
        _cleanup()


def test_interact_malformed_custom_id():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    store = {'G1': None}
    ctx = {'get_game': lambda gid: store.get(gid),
           'save_games': lambda: None}
    _, handler, _ = find_handler('interact_choice_G1_hl1dc0')
    result = handler(_Interaction('interact_choice_G1_hl1dc0'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_interact_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('interact_choice_X_hl1dc0_0_open_door_a1|a2')
    result = handler(
        _Interaction('interact_choice_X_hl1dc0_0_open_door_a1|a2'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def test_interact_figure_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_door()
    try:
        # Strip the DC list so msg_id lookup fails
        g.data['p1DcMessageIds'] = []
        g.data['p1DcList'] = []
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('interact_choice_G1_hl1dc0_0_open_door_a1|a2')
        result = handler(
            _Interaction('interact_choice_G1_hl1dc0_0_open_door_a1|a2',
                          user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'figure_not_found_for_msg_id'
    finally:
        _cleanup()


def test_interact_invalid_option_propagates_value_error():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game_with_door()
    try:
        store = {'G1': g}
        ctx = {'get_game': lambda gid: store.get(gid),
               'save_games': lambda: None}
        _, handler, _ = find_handler('interact_choice_G1_hl1dc0_0_nonsense_option')
        result = handler(
            _Interaction('interact_choice_G1_hl1dc0_0_nonsense_option',
                          user_id='alice'), ctx,
        )
        assert result['ok'] is False
        assert result['reason'] == 'value_error'
    finally:
        _cleanup()


def main():
    cases = [
        ('happy_path_opens_door', test_interact_happy_path_opens_door),
        ('rejects_non_owner', test_interact_rejects_non_owner),
        ('malformed_custom_id', test_interact_malformed_custom_id),
        ('game_not_found', test_interact_game_not_found),
        ('figure_not_found', test_interact_figure_not_found),
        ('invalid_option_value_error', test_interact_invalid_option_propagates_value_error),
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
