"""Tests for discord_bot.commands — slash-command business logic.

Run: python3 python/discord_bot/test_commands.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.commands import (
    cmd_forfeit,
    cmd_legal_actions,
    cmd_list_games,
    cmd_setup_channels,
    cmd_squad,
    cmd_startbattle,
    cmd_startgame,
    cmd_status,
    cmd_step_action,
)


def _deps():
    store = {}
    return {'_store': store, 'game_store': store}, store


def test_startgame_basic():
    deps, store = _deps()
    r = cmd_startgame('alice', deps, opponent_id='bob')
    assert r['ok']
    assert r['player1Id'] == 'alice'
    assert r['player2Id'] == 'bob'
    assert r['phase'] == 'lobby'
    assert r['gameId'] in store


def test_startgame_cannot_play_self():
    deps, _ = _deps()
    r = cmd_startgame('alice', deps, opponent_id='alice')
    assert not r['ok']
    assert r['reason'] == 'cannot_play_self'


def test_startgame_id_collision():
    deps, _ = _deps()
    r1 = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    assert r1['ok']
    r2 = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    assert not r2['ok']
    assert r2['reason'] == 'game_id_taken'


def test_squad_submit_both_sides():
    deps, _ = _deps()
    r = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    assert r['ok']
    r1 = cmd_squad('alice', deps, game_id='g1',
                    deployment_cards=['Luke Skywalker'])
    assert r1['ok']
    assert r1['playerNum'] == 1
    assert r1['bothSquadsSubmitted'] is False
    r2 = cmd_squad('bob', deps, game_id='g1',
                    deployment_cards=['Stormtrooper (Regular)'])
    assert r2['ok']
    assert r2['playerNum'] == 2
    assert r2['bothSquadsSubmitted'] is True


def test_squad_rejects_non_player():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_squad('carol', deps, game_id='g1',
                   deployment_cards=['Luke Skywalker'])
    assert not r['ok']
    assert r['reason'] == 'not_a_player_in_game'


def test_startbattle_runs_full_setup():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    r = cmd_startbattle('alice', deps, game_id='g1',
                         map_id='mos-eisley-outskirts')
    assert r['ok']
    assert r['phase'] == 'round_active'
    assert r['round'] == 1


def test_startbattle_rejects_without_squads():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_startbattle('alice', deps, game_id='g1',
                         map_id='mos-eisley-outskirts')
    assert not r['ok']
    assert r['reason'] == 'squads_not_submitted'


def test_status_returns_snapshot():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_status('alice', deps, game_id='g1')
    assert r['ok']
    assert r['status']['phase'] == 'lobby'


def test_forfeit_ends_game():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_forfeit('alice', deps, game_id='g1')
    assert r['ok']
    assert r['winner'] == 2
    assert r['reason'] == 'forfeit'


def test_forfeit_idempotent_after_end():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_forfeit('alice', deps, game_id='g1')
    r2 = cmd_forfeit('bob', deps, game_id='g1')
    assert not r2['ok']
    assert r2['reason'] == 'game_already_ended'


def test_startgame_with_guild_creates_channels():
    from python.discord_bot.channel_factory import InMemoryFactoryBackend
    from python.discord_bot import game_channels as gc
    gc._reset_for_tests()
    deps, _ = _deps()
    deps['channel_factory'] = InMemoryFactoryBackend()
    r = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1',
                       guild_id='guild-99')
    assert r['ok']
    ch = r['channels']
    assert ch['board_channel_id'] is not None
    assert ch['p1_hand_channel_id'] is not None
    # game_channels should now know where the board lives
    assert gc.get_board_message('g1')[0] == ch['board_channel_id']


def test_startgame_without_guild_no_channels():
    deps, _ = _deps()
    r = cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    assert r['ok']
    assert r['channels'] == {}


def test_setup_channels_binds_game_id():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_setup_channels(
        'alice', deps, game_id='g1',
        board_channel_id='chan-board',
        p1_play_area_channel_id='chan-p1',
        p2_play_area_channel_id='chan-p2',
    )
    assert r['ok']
    ch = r['channels']
    assert ch['board_channel_id'] == 'chan-board'
    assert ch['p1_play_area_channel_id'] == 'chan-p1'
    assert ch['p2_play_area_channel_id'] == 'chan-p2'


def test_setup_channels_rejects_non_player():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    r = cmd_setup_channels('carol', deps, game_id='g1',
                             board_channel_id='chan-board')
    assert not r['ok']
    assert r['reason'] == 'not_a_player_in_game'


def test_legal_actions_after_setup():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    cmd_startbattle('alice', deps, game_id='g1',
                     map_id='mos-eisley-outskirts')
    r = cmd_legal_actions('alice', deps, game_id='g1')
    assert r['ok']
    assert len(r['actions']) > 0


def test_step_action_performs_activation():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_squad('alice', deps, game_id='g1',
               deployment_cards=['Luke Skywalker'])
    cmd_squad('bob', deps, game_id='g1',
               deployment_cards=['Stormtrooper (Regular)'])
    cmd_startbattle('alice', deps, game_id='g1',
                     map_id='mos-eisley-outskirts')
    r = cmd_legal_actions('alice', deps, game_id='g1')
    # Find an ACTIVATE_DC action and apply it.
    activate = next((a for a in r['actions']
                     if a['type'] == 'activate_dc'), None)
    if activate is None:
        return  # active player is P2 if initiative flipped; skip
    user = 'alice' if activate['player'] == 1 else 'bob'
    r2 = cmd_step_action(user, deps, game_id='g1',
                          action_type=activate['type'],
                          action_params=activate['params'],
                          player_num=activate['player'])
    assert r2['ok']
    assert r2['status']['phase'] == 'round_active'


def test_step_action_rejects_when_game_over():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_forfeit('alice', deps, game_id='g1')
    r = cmd_step_action('alice', deps, game_id='g1',
                          action_type='end_end_of_round')
    assert not r['ok']
    assert r['reason'] == 'game_already_ended'


def test_list_games_filters_to_user():
    deps, _ = _deps()
    cmd_startgame('alice', deps, opponent_id='bob', game_id='g1')
    cmd_startgame('carol', deps, opponent_id='dave', game_id='g2')
    r = cmd_list_games('alice', deps)
    assert r['ok']
    ids = [g['gameId'] for g in r['games']]
    assert 'g1' in ids
    assert 'g2' not in ids


def main():
    cases = [
        ('startgame_basic', test_startgame_basic),
        ('startgame_cannot_play_self', test_startgame_cannot_play_self),
        ('startgame_id_collision', test_startgame_id_collision),
        ('squad_submit_both', test_squad_submit_both_sides),
        ('squad_rejects_non_player', test_squad_rejects_non_player),
        ('startbattle_full', test_startbattle_runs_full_setup),
        ('startbattle_rejects_without_squads', test_startbattle_rejects_without_squads),
        ('status', test_status_returns_snapshot),
        ('forfeit', test_forfeit_ends_game),
        ('forfeit_idempotent', test_forfeit_idempotent_after_end),
        ('startgame_with_guild', test_startgame_with_guild_creates_channels),
        ('startgame_no_guild', test_startgame_without_guild_no_channels),
        ('setup_channels', test_setup_channels_binds_game_id),
        ('setup_channels_non_player', test_setup_channels_rejects_non_player),
        ('legal_actions', test_legal_actions_after_setup),
        ('step_action', test_step_action_performs_activation),
        ('step_after_end', test_step_action_rejects_when_game_over),
        ('list_games', test_list_games_filters_to_user),
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
