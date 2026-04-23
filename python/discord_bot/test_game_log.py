"""Tests for game_log — action log posting.

Run: python3 python/discord_bot/test_game_log.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot import game_channels as gc, game_log
from python.discord_bot.channels import InMemoryBackend


def _setup():
    gc._reset_for_tests()
    gc.set_log_channel('g1', 'log-chan-1')
    return InMemoryBackend()


def test_log_action_posts_to_log_channel():
    be = _setup()
    mid = game_log.log_action('g1', 'something happened', backend=be)
    assert mid is not None
    msgs = be.list_messages('log-chan-1')
    assert len(msgs) == 1
    assert 'something happened' in msgs[0]['content']


def test_log_action_no_channel_returns_none():
    gc._reset_for_tests()
    be = InMemoryBackend()
    assert game_log.log_action('g-none', 'hi', backend=be) is None


def test_log_attack():
    be = _setup()
    game_log.log_attack('g1', 'Luke', 'Stormtrooper', 3, defeated=False,
                         backend=be)
    msgs = be.list_messages('log-chan-1')
    assert len(msgs) == 1
    txt = msgs[0]['content']
    assert 'Luke' in txt and 'Stormtrooper' in txt and '3' in txt


def test_log_attack_with_defeat():
    be = _setup()
    game_log.log_attack('g1', 'Vader', 'Rebel', 5, defeated=True, backend=be)
    msgs = be.list_messages('log-chan-1')
    assert 'defeated' in msgs[0]['content'].lower()


def test_log_round_transition():
    be = _setup()
    game_log.log_round_transition('g1', 3, backend=be)
    msgs = be.list_messages('log-chan-1')
    assert '3' in msgs[0]['content']
    assert 'Round' in msgs[0]['content']


def test_log_vp_award():
    be = _setup()
    game_log.log_vp_award('g1', 1, 5, 'Luke Skywalker kill', backend=be)
    msgs = be.list_messages('log-chan-1')
    assert '5 VP' in msgs[0]['content']


def test_log_game_over_winner():
    be = _setup()
    game_log.log_game_over('g1', 1, 'elimination', backend=be)
    msgs = be.list_messages('log-chan-1')
    assert 'Player 1 wins' in msgs[0]['content']
    # format_log_line prepends exactly one emoji.
    content = msgs[0]['content']
    assert not content.startswith('🏁 🏁'), 'duplicate emoji prefix'


def test_log_game_over_draw():
    be = _setup()
    game_log.log_game_over('g1', None, 'both eliminated', backend=be)
    msgs = be.list_messages('log-chan-1')
    assert 'draw' in msgs[0]['content']


def test_log_cc_play_and_dc_special():
    be = _setup()
    game_log.log_cc_play('g1', 2, 'Focus', backend=be)
    game_log.log_dc_special('g1', 'Luke-0-0', 'Saber Strike', backend=be)
    msgs = be.list_messages('log-chan-1')
    assert len(msgs) == 2


def test_get_log_history_returns_all():
    be = _setup()
    for i in range(3):
        game_log.log_action('g1', f'event-{i}', backend=be)
    history = game_log.get_log_history('g1', backend=be)
    assert len(history) == 3


def main():
    cases = [
        ('log_action', test_log_action_posts_to_log_channel),
        ('log_no_channel', test_log_action_no_channel_returns_none),
        ('log_attack', test_log_attack),
        ('log_attack_defeat', test_log_attack_with_defeat),
        ('log_round', test_log_round_transition),
        ('log_vp', test_log_vp_award),
        ('log_game_over_winner', test_log_game_over_winner),
        ('log_game_over_draw', test_log_game_over_draw),
        ('log_cc_and_dc', test_log_cc_play_and_dc_special),
        ('log_history', test_get_log_history_returns_all),
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
