"""Tests for combat_special_effects handler skip paths."""
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
    from python.discord_bot.handlers import combat_special_effects as cse
    handlers.reset_for_tests()
    handlers.register('sidewinder_skip_', cse._handle_sidewinder_skip, 'core')
    handlers.register('boltslinger_skip_', cse._handle_boltslinger_skip, 'core')
    handlers.register('indiscriminate_skip_', cse._handle_indiscriminate_skip, 'core')
    handlers.register('fighting_knife_skip_', cse._handle_fighting_knife_skip, 'core')
    handlers.register('havoc_shot_skip_', cse._handle_havoc_shot_skip, 'core')
    handlers.register('deflect_skip_', cse._handle_deflect_skip, 'core')
    handlers.register('wanton_skip_', cse._handle_wanton_skip, 'core')
    handlers.register('heavy_fire_skip_', cse._handle_heavy_fire_skip, 'core')
    handlers.register('zillo_discard_skip_', cse._handle_zillo_discard_skip, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_sidewinder_skip_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('sidewinder_skip_G1')
    result = handler(_Interaction('sidewinder_skip_G1'), {})
    assert result['ok'] is True
    assert result['gameId'] == 'G1'


def test_sidewinder_skip_empty_game_id():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('sidewinder_skip_')
    result = handler(_Interaction('sidewinder_skip_'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_boltslinger_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingBoltslinger'] = {'attackerMsgId': 'hl1dc0', 'choices': []}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('boltslinger_skip_G1')
    result = handler(_Interaction('boltslinger_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingBoltslinger' not in g.data


def test_boltslinger_skip_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('boltslinger_skip_MISSING')
    result = handler(_Interaction('boltslinger_skip_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def test_indiscriminate_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingIndiscriminateFire'] = {'dieIndex': 0}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('indiscriminate_skip_G1')
    result = handler(_Interaction('indiscriminate_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingIndiscriminateFire' not in g.data
    assert result['pendingCleared'] == 'pendingIndiscriminateFire'


def test_fighting_knife_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingFightingKnife'] = {'dcName': 'Ezra'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('fighting_knife_skip_G1')
    result = handler(_Interaction('fighting_knife_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingFightingKnife' not in g.data


def test_havoc_shot_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingHavocShot'] = {'attackerMsgId': 'hl1dc0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('havoc_shot_skip_G1')
    result = handler(_Interaction('havoc_shot_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingHavocShot' not in g.data


def test_deflect_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingDeflect'] = {'playerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('deflect_skip_G1')
    result = handler(_Interaction('deflect_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingDeflect' not in g.data


def test_zillo_discard_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingZilloDiscard'] = {'defenderPN': 2}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('zillo_discard_skip_G1')
    result = handler(_Interaction('zillo_discard_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingZilloDiscard' not in g.data


def test_heavy_fire_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingHeavyFire'] = {'attackerPlayerNum': 1, 'picks': []}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('heavy_fire_skip_G1')
    result = handler(_Interaction('heavy_fire_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingHeavyFire' not in g.data


def test_wanton_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingWanton'] = {'attackerPlayerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('wanton_skip_G1')
    result = handler(_Interaction('wanton_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingWanton' not in g.data


def main():
    cases = [
        ('sidewinder_skip_ok', test_sidewinder_skip_ok),
        ('sidewinder_skip_malformed', test_sidewinder_skip_empty_game_id),
        ('boltslinger_skip_clears', test_boltslinger_skip_clears_pending),
        ('boltslinger_skip_no_game', test_boltslinger_skip_game_not_found),
        ('indiscriminate_skip_clears', test_indiscriminate_skip_clears_pending),
        ('fighting_knife_skip_clears', test_fighting_knife_skip_clears_pending),
        ('havoc_shot_skip_clears', test_havoc_shot_skip_clears_pending),
        ('deflect_skip_clears', test_deflect_skip_clears_pending),
        ('wanton_skip_clears', test_wanton_skip_clears_pending),
        ('heavy_fire_skip_clears', test_heavy_fire_skip_clears_pending),
        ('zillo_discard_skip_clears', test_zillo_discard_skip_clears_pending),
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
