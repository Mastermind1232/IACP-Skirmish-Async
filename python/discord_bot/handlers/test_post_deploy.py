"""Tests for post_deploy Discord handler."""
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
    from python.discord_bot.handlers import post_deploy as pd
    handlers.reset_for_tests()
    handlers.register('pd_strike_token_done_',
                      pd._handle_pd_strike_token_done, 'postDeploy')
    handlers.register('pd_walker_skip_',
                      pd._handle_pd_walker_skip, 'postDeploy')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_strike_token_done_clears_active_ability():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['postDeployQueue'] = {
        'currentPlayerNum': 1,
        'activeAbility': {'abilityId': 'strike_team_cassian', 'step': 'token'},
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('pd_strike_token_done_G1')
    result = handler(
        _Interaction('pd_strike_token_done_G1', user_id='alice'), ctx,
    )
    assert result['ok'] is True
    assert result['currentPlayerNum'] == 1
    assert g.data['postDeployQueue']['activeAbility'] is None


def test_strike_token_done_rejects_non_owner():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['postDeployQueue'] = {'currentPlayerNum': 1, 'activeAbility': {}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('pd_strike_token_done_G1')
    result = handler(
        _Interaction('pd_strike_token_done_G1', user_id='bob'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'not_owner'


def test_walker_skip_clears_active_ability():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['postDeployQueue'] = {
        'currentPlayerNum': 2,
        'activeAbility': {'abilityId': 'scavenged_walker_move'},
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('pd_walker_skip_G1')
    result = handler(_Interaction('pd_walker_skip_G1', user_id='bob'), ctx)
    assert result['ok'] is True
    assert result['currentPlayerNum'] == 2
    assert g.data['postDeployQueue']['activeAbility'] is None


def test_no_queue_rejects_cleanly():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('pd_strike_token_done_G1')
    result = handler(
        _Interaction('pd_strike_token_done_G1', user_id='alice'), ctx,
    )
    assert result['ok'] is False
    assert result['reason'] == 'no_post_deploy_queue'


def test_game_not_found():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    ctx = {'get_game': lambda gid: None, 'save_games': lambda: None}
    _, handler, _ = find_handler('pd_walker_skip_MISSING')
    result = handler(_Interaction('pd_walker_skip_MISSING'), ctx)
    assert result['ok'] is False
    assert result['reason'] == 'game_not_found'


def main():
    cases = [
        ('strike_token_done_clears', test_strike_token_done_clears_active_ability),
        ('strike_token_done_non_owner', test_strike_token_done_rejects_non_owner),
        ('walker_skip_clears', test_walker_skip_clears_active_ability),
        ('no_queue', test_no_queue_rejects_cleanly),
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
