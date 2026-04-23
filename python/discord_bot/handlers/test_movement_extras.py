"""Tests for movement_extras skip handlers."""
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
    from python.discord_bot.handlers import movement_extras as mx
    handlers.reset_for_tests()
    handlers.register('mvint_skip_', mx._handle_mvint_skip, 'core')
    handlers.register('ow_interrupt_skip_', mx._handle_ow_interrupt_skip, 'core')
    handlers.register('dio_stay_', mx._handle_dio_stay, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_mvint_skip_clears_pending_with_trailing():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingMoveInterrupt'] = {'figureKey': 'Luke-0-0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    # mvint_skip_{gameId}_{triggerType}_{figureKey}
    cid = 'mvint_skip_G1_deference_Luke-0-0'
    _, handler, _ = find_handler(cid)
    result = handler(_Interaction(cid), ctx)
    assert result['ok'] is True
    assert result['gameId'] == 'G1'
    assert 'pendingMoveInterrupt' not in g.data


def test_ow_interrupt_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingOverwatchInterrupt'] = {'attackerMsgId': 'hl1dc0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    cid = 'ow_interrupt_skip_G1_hl1dc0'
    _, handler, _ = find_handler(cid)
    result = handler(_Interaction(cid), ctx)
    assert result['ok'] is True
    assert 'pendingOverwatchInterrupt' not in g.data


def test_dio_stay_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingDioFollow'] = {'dcName': 'Dio'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('dio_stay_G1')
    result = handler(_Interaction('dio_stay_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingDioFollow' not in g.data


def test_dio_stay_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('dio_stay_MISSING')
    result = handler(_Interaction('dio_stay_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('mvint_skip_trailing', test_mvint_skip_clears_pending_with_trailing),
        ('ow_interrupt_skip', test_ow_interrupt_skip_clears_pending),
        ('dio_stay', test_dio_stay_clears_pending),
        ('dio_stay_no_game', test_dio_stay_game_not_found),
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
