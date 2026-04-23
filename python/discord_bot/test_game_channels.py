"""Tests for game_channels — per-game channel tracking + refresh.

Run: python3 python/discord_bot/test_game_channels.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot import game_channels as gc
from python.discord_bot.channels import InMemoryBackend


def test_board_message_roundtrip():
    gc._reset_for_tests()
    gc.set_board_message('g1', 'chan-42', 'msg-100')
    assert gc.get_board_message('g1') == ('chan-42', 'msg-100')


def test_board_message_unset_returns_none_pair():
    gc._reset_for_tests()
    assert gc.get_board_message('g-none') == (None, None)


def test_play_area_and_hand_channels():
    gc._reset_for_tests()
    gc.set_play_area('g1', 1, 'p1-play')
    gc.set_play_area('g1', 2, 'p2-play')
    gc.set_hand_channel('g1', 1, 'p1-hand', 'hand-msg-1')
    assert gc.get_play_area('g1', 1) == 'p1-play'
    assert gc.get_play_area('g1', 2) == 'p2-play'
    assert gc.get_hand_channel('g1', 1) == ('p1-hand', 'hand-msg-1')
    assert gc.get_hand_channel('g1', 2) == (None, None)


def test_get_all_returns_full_dict():
    gc._reset_for_tests()
    gc.set_board_message('g1', 'c', 'm')
    gc.set_log_channel('g1', 'log-chan')
    d = gc.get_all('g1')
    assert d['board_channel_id'] == 'c'
    assert d['log_channel_id'] == 'log-chan'


def test_clear_removes_game():
    gc._reset_for_tests()
    gc.set_board_message('g1', 'c', 'm')
    gc.clear('g1')
    assert gc.get_board_message('g1') == (None, None)
    assert 'g1' not in gc.list_games()


def test_refresh_game_view_posts_when_no_message():
    gc._reset_for_tests()
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    g.data['player1Id'] = 'a'; g.data['player2Id'] = 'b'
    g.data['phase'] = 'lobby'
    gc.set_board_message('g1', 'chan-1', None)
    ok = gc.refresh_game_view('g1', g, backend=be)
    assert ok
    # Channel + new message id recorded
    cid, mid = gc.get_board_message('g1')
    assert cid == 'chan-1'
    assert mid is not None
    assert be.fetch(cid, mid) is not None


def test_refresh_game_view_edits_when_message_exists():
    gc._reset_for_tests()
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    g.data['player1Id'] = 'a'; g.data['player2Id'] = 'b'
    g.data['phase'] = 'lobby'
    # Post an initial message manually
    mid = be.post('chan-1', {'content': 'old'})
    gc.set_board_message('g1', 'chan-1', mid)
    # Refresh — should edit instead of post new
    ok = gc.refresh_game_view('g1', g, backend=be)
    assert ok
    cid, new_mid = gc.get_board_message('g1')
    # Message id unchanged
    assert new_mid == mid
    assert be.fetch(cid, mid)['content'] != 'old'


def test_refresh_game_view_no_channel_returns_false():
    gc._reset_for_tests()
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    assert gc.refresh_game_view('g-unseen', g, backend=be) is False


def test_refresh_hand_view_posts_new():
    gc._reset_for_tests()
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    g.data['player1CcHand'] = ['Focus', 'Rally']
    gc.set_hand_channel('g1', 1, 'hand-chan-1')
    ok = gc.refresh_hand_view('g1', 1, g, backend=be)
    assert ok
    cid, mid = gc.get_hand_channel('g1', 1)
    assert mid is not None
    msg = be.fetch(cid, mid)
    assert 'Focus' in msg['content']
    assert 'Rally' in msg['content']


def main():
    cases = [
        ('board_roundtrip', test_board_message_roundtrip),
        ('board_unset', test_board_message_unset_returns_none_pair),
        ('play_area_hand', test_play_area_and_hand_channels),
        ('get_all', test_get_all_returns_full_dict),
        ('clear', test_clear_removes_game),
        ('refresh_posts', test_refresh_game_view_posts_when_no_message),
        ('refresh_edits', test_refresh_game_view_edits_when_message_exists),
        ('refresh_no_channel', test_refresh_game_view_no_channel_returns_false),
        ('refresh_hand', test_refresh_hand_view_posts_new),
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
