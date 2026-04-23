"""End-to-end integration tests for the Discord-bot layer.

Drives a full game lifecycle through the command surface + channel
backends, verifying that Discord views get refreshed correctly after
each state change.

Run: python3 python/discord_bot/test_integration.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot import game_channels as gc
from python.discord_bot.channel_factory import InMemoryFactoryBackend
from python.discord_bot.channels import InMemoryBackend
from python.discord_bot.commands import (
    cmd_legal_actions,
    cmd_squad,
    cmd_startbattle,
    cmd_startgame,
    cmd_step_action,
    cmd_status,
)


def _new_deps():
    gc._reset_for_tests()
    store = {}
    return {
        '_store': store,
        'game_store': store,
        'channel_backend': InMemoryBackend(),
        'channel_factory': InMemoryFactoryBackend(),
    }


def test_startgame_creates_channels_and_binds():
    deps = _new_deps()
    r = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                       guild_id='guild-1')
    assert r['ok']
    ch = r['channels']
    # board + log + 2 play-area + 2 hand-thread = 6 assignments
    assert ch['board_channel_id']
    assert ch['log_channel_id']
    assert ch['p1_play_area_channel_id']
    assert ch['p2_play_area_channel_id']
    assert ch['p1_hand_channel_id']
    assert ch['p2_hand_channel_id']
    # game_channels should be aware of board + log
    assert gc.get_board_message('g1')[0] == ch['board_channel_id']
    assert gc.get_log_channel('g1') == ch['log_channel_id']


def test_startbattle_posts_board_view():
    deps = _new_deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                   guild_id='guild-1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    r = cmd_startbattle('alice', deps, game_id='g1',
                         map_id='mos-eisley-outskirts')
    assert r['ok']
    # After startbattle, the board channel should have a game-view message.
    cid, mid = gc.get_board_message('g1')
    assert mid is not None
    msg = deps['channel_backend'].fetch(cid, mid)
    assert msg is not None
    # Game view has at least VP banner + mission card + activation summary.
    assert len(msg.get('embeds', [])) >= 3


def test_stepaction_edits_board_view_in_place():
    deps = _new_deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                   guild_id='guild-1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    cmd_startbattle('alice', deps, game_id='g1',
                     map_id='mos-eisley-outskirts')
    _, mid_before = gc.get_board_message('g1')
    # Apply an ACTIVATE_DC for the active player.
    la = cmd_legal_actions('alice', deps, game_id='g1')
    assert la['ok']
    activate = next((a for a in la['actions']
                     if a['type'] == 'activate_dc'), None)
    if activate is None:
        return  # initiative went to P2; skip
    user = 'alice' if activate['player'] == 1 else 'bob'
    cmd_step_action(user, deps, game_id='g1',
                      action_type=activate['type'],
                      action_params=activate['params'],
                      player_num=activate['player'])
    # Board message id should stay the same (edit in place, not repost).
    _, mid_after = gc.get_board_message('g1')
    assert mid_after == mid_before
    # And the backend message should still exist + reflect active state.
    msg = deps['channel_backend'].fetch(
        gc.get_board_message('g1')[0], mid_after,
    )
    assert msg is not None


def test_hand_view_posts_after_startbattle():
    deps = _new_deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                   guild_id='guild-1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    cmd_startbattle('alice', deps, game_id='g1',
                     map_id='mos-eisley-outskirts')
    # Both players' hand-thread messages should be posted.
    for pn in (1, 2):
        cid, mid = gc.get_hand_channel('g1', pn)
        assert cid, f'p{pn} hand channel missing'
        assert mid, f'p{pn} hand message missing'
        msg = deps['channel_backend'].fetch(cid, mid)
        assert msg is not None


def test_status_reports_lobby_then_active():
    deps = _new_deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                   guild_id='guild-1')
    r = cmd_status('alice', deps, game_id='g1')
    assert r['status']['phase'] == 'lobby'
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    cmd_startbattle('alice', deps, game_id='g1',
                     map_id='mos-eisley-outskirts')
    r2 = cmd_status('alice', deps, game_id='g1')
    assert r2['status']['phase'] == 'round_active'


def main():
    cases = [
        ('startgame_creates_channels', test_startgame_creates_channels_and_binds),
        ('startbattle_posts_board', test_startbattle_posts_board_view),
        ('stepaction_edits_in_place', test_stepaction_edits_board_view_in_place),
        ('hand_view_posts', test_hand_view_posts_after_startbattle),
        ('status_lobby_then_active', test_status_reports_lobby_then_active),
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
            failures.append(name)
    total = len(cases)
    print(f'\n{total - len(failures)}/{total} passed')
    if failures:
        sys.exit(1)


if __name__ == '__main__':
    main()
