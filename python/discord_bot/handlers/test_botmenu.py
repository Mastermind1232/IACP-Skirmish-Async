"""Tests for botmenu Discord handlers."""
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
    from python.discord_bot.handlers import botmenu as bm
    handlers.reset_for_tests()
    handlers.register('botmenu_kill_no_', bm._handle_botmenu_kill_no, 'core')
    handlers.register('forfeit_no_', bm._handle_forfeit_no, 'core')
    handlers.register('botmenu_kill_', bm._handle_botmenu_kill, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_botmenu_kill_no_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('botmenu_kill_no_G1')
    result = handler(_Interaction('botmenu_kill_no_G1'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'


def test_botmenu_kill_no_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('botmenu_kill_no_')
    result = handler(_Interaction('botmenu_kill_no_'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_forfeit_no_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('forfeit_no_G1')
    result = handler(_Interaction('forfeit_no_G1'), {})
    assert result['ok'] is True


def test_botmenu_kill_allows_player1():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('botmenu_kill_G1')
    result = handler(_Interaction('botmenu_kill_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['isPlayer'] is True


def test_botmenu_kill_allows_player2():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('botmenu_kill_G1')
    result = handler(_Interaction('botmenu_kill_G1', user_id='bob'), ctx)
    assert result['ok'] is True


def test_botmenu_kill_rejects_stranger():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid)}
    _, handler, _ = find_handler('botmenu_kill_G1')
    result = handler(_Interaction('botmenu_kill_G1', user_id='stranger'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'not_authorized'


def test_botmenu_kill_admin_bypass():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'is_admin': True}
    _, handler, _ = find_handler('botmenu_kill_G1')
    result = handler(_Interaction('botmenu_kill_G1', user_id='stranger'), ctx)
    assert result['ok'] is True
    assert result['isPlayer'] is False


def test_botmenu_kill_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None}
    _, handler, _ = find_handler('botmenu_kill_MISSING')
    result = handler(_Interaction('botmenu_kill_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('kill_no_ok', test_botmenu_kill_no_ok),
        ('kill_no_malformed', test_botmenu_kill_no_malformed),
        ('forfeit_no_ok', test_forfeit_no_ok),
        ('kill_allows_p1', test_botmenu_kill_allows_player1),
        ('kill_allows_p2', test_botmenu_kill_allows_player2),
        ('kill_rejects_stranger', test_botmenu_kill_rejects_stranger),
        ('kill_admin_bypass', test_botmenu_kill_admin_bypass),
        ('kill_game_not_found', test_botmenu_kill_game_not_found),
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
