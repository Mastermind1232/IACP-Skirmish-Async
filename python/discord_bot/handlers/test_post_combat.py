"""Tests for post_combat skip handlers."""
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
    from python.discord_bot.handlers import post_combat as pc
    handlers.reset_for_tests()
    handlers.register('reaction_skip_', pc._handle_reaction_skip, 'core')
    handlers.register('mastery_skip_', pc._handle_mastery_skip, 'core')
    handlers.register('interrogate_skip_', pc._handle_interrogate_skip, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_reaction_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingReaction'] = {'ownerId': 'alice', 'cardName': 'Vengeance'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_skip_G1')
    result = handler(_Interaction('reaction_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingReaction' not in g.data


def test_mastery_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingMastery'] = {'attackerPlayerNum': 1}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('mastery_skip_G1')
    result = handler(_Interaction('mastery_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingMastery' not in g.data


def test_interrogate_skip_clears_pending():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingInterrogate'] = {'attackerPlayerNum': 1, 'chosenCardName': 'Focus'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('interrogate_skip_G1')
    result = handler(_Interaction('interrogate_skip_G1'), ctx)
    assert result['ok'] is True
    assert 'pendingInterrogate' not in g.data


def test_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('reaction_skip_MISSING')
    result = handler(_Interaction('reaction_skip_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('reaction_skip', test_reaction_skip_clears_pending),
        ('mastery_skip', test_mastery_skip_clears_pending),
        ('interrogate_skip', test_interrogate_skip_clears_pending),
        ('no_game', test_game_not_found),
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
