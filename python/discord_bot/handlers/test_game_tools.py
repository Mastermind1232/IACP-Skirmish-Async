"""Tests for game_tools Discord handlers."""
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
    from python.discord_bot.handlers import game_tools as gt
    handlers.reset_for_tests()
    handlers.register('refresh_map_', gt._handle_refresh_map, 'core')
    handlers.register('refresh_all_', gt._handle_refresh_all, 'core')
    handlers.register('undo_', gt._handle_undo, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_refresh_map_validates_participant():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['selectedMap'] = {'id': 'mos-eisley-outskirts'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('refresh_map_G1')
    ok = handler(_Interaction('refresh_map_G1', user_id='alice'), ctx)
    assert ok['ok'] is True
    nope = handler(_Interaction('refresh_map_G1', user_id='stranger'), ctx)
    assert nope['ok'] is False
    assert nope['reason'] == 'not_a_player_in_game'


def test_refresh_map_rejects_no_map():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('refresh_map_G1')
    result = handler(_Interaction('refresh_map_G1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_map_selected'


def test_refresh_all_allows_participant():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('refresh_all_G1')
    result = handler(_Interaction('refresh_all_G1', user_id='alice'), ctx)
    assert result['ok'] is True


def test_undo_pops_stack():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['undoStack'] = [{'snap': 1}, {'snap': 2}]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('undo_G1')
    result = handler(_Interaction('undo_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['snapshotPopped'] is True
    assert result['stackRemaining'] == 1
    assert g.data['undoStack'] == [{'snap': 1}]


def test_undo_empty_stack():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('undo_G1')
    result = handler(_Interaction('undo_G1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'no_undo_available'


def test_undo_rejects_non_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['undoStack'] = [{'snap': 1}]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('undo_G1')
    result = handler(_Interaction('undo_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_a_player_in_game'


def main():
    cases = [
        ('refresh_map_validates', test_refresh_map_validates_participant),
        ('refresh_map_no_map', test_refresh_map_rejects_no_map),
        ('refresh_all_ok', test_refresh_all_allows_participant),
        ('undo_pops', test_undo_pops_stack),
        ('undo_empty', test_undo_empty_stack),
        ('undo_non_player', test_undo_rejects_non_player),
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
