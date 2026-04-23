"""Tests for lobby Discord handlers."""
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
    from python.discord_bot.handlers import lobby as lb
    handlers.reset_for_tests()
    handlers.register('lobby_join_', lb._handle_lobby_join, 'core')
    handlers.register('lobby_start_', lb._handle_lobby_start, 'core')


def test_lobby_join_sets_joined_and_full():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    lobbies = {'T1': {'creatorId': 'alice', 'status': 'Open'}}
    ctx = {'lobbies': lobbies}
    _, handler, _ = find_handler('lobby_join_T1')
    result = handler(_Interaction('lobby_join_T1', user_id='bob'), ctx)
    assert result['ok'] is True
    assert lobbies['T1']['joinedId'] == 'bob'
    assert lobbies['T1']['status'] == 'Full'


def test_lobby_join_rejects_already_full():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    lobbies = {'T1': {'creatorId': 'alice', 'joinedId': 'bob', 'status': 'Full'}}
    ctx = {'lobbies': lobbies}
    _, handler, _ = find_handler('lobby_join_T1')
    result = handler(_Interaction('lobby_join_T1', user_id='carol'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'lobby_full'


def test_lobby_join_enforces_max_games():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    lobbies = {'T1': {'creatorId': 'alice', 'status': 'Open'}}
    ctx = {
        'lobbies': lobbies,
        'MAX_ACTIVE_GAMES_PER_PLAYER': 2,
        'count_active_games_for_player': lambda uid: 2 if uid == 'bob' else 0,
    }
    _, handler, _ = find_handler('lobby_join_T1')
    result = handler(_Interaction('lobby_join_T1', user_id='bob'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'max_active_games_reached'
    assert result['maxGames'] == 2


def test_lobby_start_only_creator():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    lobbies = {'T1': {'creatorId': 'alice', 'joinedId': 'bob', 'status': 'Full'}}
    ctx = {'lobbies': lobbies}
    _, handler, _ = find_handler('lobby_start_T1')
    bad = handler(_Interaction('lobby_start_T1', user_id='bob'), ctx)
    assert bad['ok'] is False
    assert bad['reason'] == 'only_creator_can_start'
    ok = handler(_Interaction('lobby_start_T1', user_id='alice'), ctx)
    assert ok['ok'] is True
    assert lobbies['T1']['status'] == 'Started'


def test_lobby_start_requires_joined():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    lobbies = {'T1': {'creatorId': 'alice', 'status': 'Open'}}
    ctx = {'lobbies': lobbies}
    _, handler, _ = find_handler('lobby_start_T1')
    result = handler(_Interaction('lobby_start_T1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'lobby_not_ready'


def test_lobby_missing_lobbies_ctx():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('lobby_join_T1')
    result = handler(_Interaction('lobby_join_T1'), {})
    assert result['ok'] is False
    assert result['reason'] == 'lobbies_not_in_context'


def main():
    cases = [
        ('join_sets_full', test_lobby_join_sets_joined_and_full),
        ('join_already_full', test_lobby_join_rejects_already_full),
        ('join_max_games', test_lobby_join_enforces_max_games),
        ('start_only_creator', test_lobby_start_only_creator),
        ('start_requires_joined', test_lobby_start_requires_joined),
        ('missing_lobbies_ctx', test_lobby_missing_lobbies_ctx),
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
