"""Tests for map_events queue-skip handlers."""
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
    from python.discord_bot.handlers import map_events as me
    handlers.reset_for_tests()
    handlers.register('krykna_place_skip_', me._handle_krykna_place_skip, 'core')
    handlers.register('fluctuation_skip_', me._handle_fluctuation_skip, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_krykna_skip_shifts_queue():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingClaimedKryknaQueue'] = [1, 2]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('krykna_place_skip_G1')
    result = handler(_Interaction('krykna_place_skip_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert result['playerSkipped'] == 1
    assert g.data['pendingClaimedKryknaQueue'] == [2]


def test_krykna_skip_drops_outer_when_empty():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingClaimedKryknaQueue'] = [1]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('krykna_place_skip_G1')
    result = handler(_Interaction('krykna_place_skip_G1', user_id='alice'), ctx)
    assert result['ok'] is True
    assert 'pendingClaimedKryknaQueue' not in g.data


def test_krykna_skip_rejects_wrong_player():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingClaimedKryknaQueue'] = [2]  # P2's turn
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('krykna_place_skip_G1')
    result = handler(_Interaction('krykna_place_skip_G1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'wrong_player_turn'
    assert result['expectedPlayerNum'] == 2


def test_krykna_skip_empty_queue():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('krykna_place_skip_G1')
    result = handler(_Interaction('krykna_place_skip_G1', user_id='alice'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'queue_empty'


def test_fluctuation_skip_shifts_queue():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingFluctuationSwapQueue'] = [2, 1]
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('fluctuation_skip_G1')
    result = handler(_Interaction('fluctuation_skip_G1', user_id='bob'), ctx)
    assert result['ok'] is True
    assert result['playerSkipped'] == 2
    assert g.data['pendingFluctuationSwapQueue'] == [1]


def main():
    cases = [
        ('krykna_skip_shifts', test_krykna_skip_shifts_queue),
        ('krykna_skip_drops_outer', test_krykna_skip_drops_outer_when_empty),
        ('krykna_skip_wrong_player', test_krykna_skip_rejects_wrong_player),
        ('krykna_skip_empty_queue', test_krykna_skip_empty_queue),
        ('fluctuation_skip_shifts', test_fluctuation_skip_shifts_queue),
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
