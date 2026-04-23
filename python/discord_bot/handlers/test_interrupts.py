"""Tests for interrupts skip handlers."""
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
    from python.discord_bot.handlers import interrupts as it
    handlers.reset_for_tests()
    for prefix, fn in (
        ('still_faster_skip_', it._handle_still_faster_skip),
        ('squad_swarm_no_', it._handle_squad_swarm_no),
        ('self_destruct_probe_skip_', it._handle_self_destruct_probe_skip),
        ('self_destruct_protocol_skip_', it._handle_self_destruct_protocol_skip),
        ('last_resort_skip_', it._handle_last_resort_skip),
        ('submit_fight_skip_', it._handle_submit_fight_skip),
        ('scavenged_walker_skip_', it._handle_scavenged_walker_skip),
        ('dbh_skip_', it._handle_dbh_skip),
        ('executor_skip_', it._handle_executor_skip),
        ('extra_protection_skip_', it._handle_extra_protection_skip),
        ('bm_skip_', it._handle_bm_skip),
    ):
        handlers.register(prefix, fn, 'core')


def _game():
    from python.engine.creation import create_game
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    return g


def test_still_faster_skip_clears_with_trailing():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingStillFaster'] = {'activatingMsgId': 'hl1dc0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('still_faster_skip_G1_hl1dc0')
    result = handler(_Interaction('still_faster_skip_G1_hl1dc0'), ctx)
    assert result['ok'] is True
    assert 'pendingStillFaster' not in g.data


def test_squad_swarm_no_clears():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingSquadSwarm'] = {'msgId': 'hl2dc0'}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('squad_swarm_no_G1_hl2dc0')
    result = handler(_Interaction('squad_swarm_no_G1_hl2dc0'), ctx)
    assert result['ok'] is True
    assert 'pendingSquadSwarm' not in g.data


def test_bm_skip_clears_per_player_entry():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingBlackMarket'] = {
        1: {'topCard': 'Focus', 'smugglerFk': 'Han-0-0'},
        2: {'topCard': 'Rally'},
    }
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('bm_skip_G1_hl1dc0_1')
    result = handler(_Interaction('bm_skip_G1_hl1dc0_1'), ctx)
    assert result['ok'] is True
    # P1 cleared, P2 preserved
    assert 1 not in g.data['pendingBlackMarket']
    assert 2 in g.data['pendingBlackMarket']


def test_bm_skip_drops_outer_key_when_empty():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    g.data['pendingBlackMarket'] = {1: {}}
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    _, handler, _ = find_handler('bm_skip_G1_hl1dc0_1')
    result = handler(_Interaction('bm_skip_G1_hl1dc0_1'), ctx)
    assert result['ok'] is True
    assert 'pendingBlackMarket' not in g.data


def test_bm_skip_malformed():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    _, handler, _ = find_handler('bm_skip_G1')
    result = handler(_Interaction('bm_skip_G1'), {})
    assert result['ok'] is False


def test_all_skips_no_op_when_pending_missing():
    _fresh_registry()
    from python.discord_bot.handlers import find_handler
    g = _game()
    store = {'G1': g}
    ctx = {'get_game': lambda gid: store.get(gid), 'save_games': lambda: None}
    for cid in (
        'self_destruct_probe_skip_G1',
        'self_destruct_protocol_skip_G1',
        'last_resort_skip_G1',
        'submit_fight_skip_G1',
        'scavenged_walker_skip_G1',
        'dbh_skip_G1',
        'executor_skip_G1',
        'extra_protection_skip_G1',
    ):
        _, handler, _ = find_handler(cid)
        result = handler(_Interaction(cid), ctx)
        assert result['ok'] is True, f'{cid} should be ok'


def main():
    cases = [
        ('still_faster_skip', test_still_faster_skip_clears_with_trailing),
        ('squad_swarm_no', test_squad_swarm_no_clears),
        ('bm_skip_clears', test_bm_skip_clears_per_player_entry),
        ('bm_skip_drops_outer', test_bm_skip_drops_outer_key_when_empty),
        ('bm_skip_malformed', test_bm_skip_malformed),
        ('skips_no_op_missing', test_all_skips_no_op_when_pending_missing),
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
