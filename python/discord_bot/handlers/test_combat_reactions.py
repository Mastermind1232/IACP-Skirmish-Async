"""Tests for combat_reactions skip handlers."""
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
    from python.discord_bot.handlers import combat_reactions as cr
    handlers.reset_for_tests()
    handlers.register('there_is_no_try_skip_', cr._handle_there_is_no_try_skip, 'core')
    handlers.register('tough_luck_skip_', cr._handle_tough_luck_skip, 'core')
    handlers.register('hunter_protocol_skip_', cr._handle_hunter_protocol_skip, 'core')
    handlers.register('strike_me_down_no_', cr._handle_strike_me_down_no, 'core')
    handlers.register('slow_on_draw_no_', cr._handle_slow_on_draw_no, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_there_is_no_try_skip_clears_and_sets_tint_flag():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingThereIsNoTry'] = {'pickedDieIdx': 0}
    g.data['pendingCombat'] = {'defenseDiceResults': []}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('there_is_no_try_skip_G1')
    result = handler(_Interaction('there_is_no_try_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingThereIsNoTry' not in g.data
    assert g.data['pendingCombat']['tintResolved'] is True


def test_there_is_no_try_skip_no_combat_is_ok():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingThereIsNoTry'] = {'pickedDieIdx': 0}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('there_is_no_try_skip_G1')
    result = handler(_Interaction('there_is_no_try_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingThereIsNoTry' not in g.data


def test_tough_luck_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingToughLuck'] = {'attackerPlayerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('tough_luck_skip_G1')
    result = handler(_Interaction('tough_luck_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingToughLuck' not in g.data
    assert result['combatFlagSet'] is None


def test_hunter_protocol_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingHunterProtocol'] = {'attackerMsgId': 'hl1dc0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('hunter_protocol_skip_G1')
    result = handler(_Interaction('hunter_protocol_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingHunterProtocol' not in g.data


def test_strike_me_down_no_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingStrikeMeDown'] = {'defenderPlayerNum': 1, 'combatThreadId': 't1'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('strike_me_down_no_G1')
    result = handler(_Interaction('strike_me_down_no_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingStrikeMeDown' not in g.data


def test_slow_on_draw_no_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingSlowOnTheDraw'] = {'defenderPlayerNum': 2}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('slow_on_draw_no_G1')
    result = handler(_Interaction('slow_on_draw_no_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingSlowOnTheDraw' not in g.data


def test_skip_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('there_is_no_try_skip_')
    result = handler(_Interaction('there_is_no_try_skip_'), {})
    assert result['ok'] is False
    assert result['reason'] == 'malformed_custom_id'


def test_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('tough_luck_skip_MISSING')
    result = handler(_Interaction('tough_luck_skip_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('tint_skip_clears_and_flag', test_there_is_no_try_skip_clears_and_sets_tint_flag),
        ('tint_skip_no_combat_ok', test_there_is_no_try_skip_no_combat_is_ok),
        ('tough_luck_skip', test_tough_luck_skip_clears_pending),
        ('hunter_protocol_skip', test_hunter_protocol_skip_clears_pending),
        ('strike_me_down_no', test_strike_me_down_no_clears_pending),
        ('slow_on_draw_no', test_slow_on_draw_no_clears_pending),
        ('skip_malformed', test_skip_malformed),
        ('game_not_found', test_game_not_found),
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
