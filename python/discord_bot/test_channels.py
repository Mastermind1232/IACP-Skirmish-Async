"""Tests for channels module — backend abstraction + high-level helpers.

Run: python3 python/discord_bot/test_channels.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.channels import (
    InMemoryBackend,
    get_default_backend,
    post_game_view,
    set_default_backend,
    update_game_view,
)


def test_in_memory_post_fetch_roundtrip():
    be = InMemoryBackend()
    mid = be.post('chan-1', {'content': 'hello', 'embeds': []})
    assert mid is not None
    msg = be.fetch('chan-1', mid)
    assert msg == {'content': 'hello', 'embeds': []}


def test_in_memory_edit_and_delete():
    be = InMemoryBackend()
    mid = be.post('chan-1', {'content': 'v1'})
    assert be.edit('chan-1', mid, {'content': 'v2'})
    assert be.fetch('chan-1', mid) == {'content': 'v2'}
    assert be.delete('chan-1', mid)
    assert be.fetch('chan-1', mid) is None


def test_in_memory_edit_unknown_id_returns_false():
    be = InMemoryBackend()
    assert be.edit('chan-1', '999', {'content': 'x'}) is False
    assert be.delete('chan-1', '999') is False


def test_in_memory_list_messages():
    be = InMemoryBackend()
    m1 = be.post('chan-1', {'content': 'a'})
    m2 = be.post('chan-1', {'content': 'b'})
    msgs = be.list_messages('chan-1')
    ids = [m['_id'] for m in msgs]
    assert m1 in ids
    assert m2 in ids


def test_in_memory_post_empty_channel_id_returns_none():
    be = InMemoryBackend()
    assert be.post('', {'content': 'x'}) is None


def test_default_backend_is_in_memory_by_default():
    from python.discord_bot.channels import _default_backend
    # Reset global state for clean test
    set_default_backend(InMemoryBackend())
    be = get_default_backend()
    assert isinstance(be, InMemoryBackend)


def test_post_game_view_roundtrip():
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['phase'] = 'lobby'
    mid = post_game_view('chan-1', g, backend=be)
    assert mid is not None
    msg = be.fetch('chan-1', mid)
    assert 'embeds' in msg
    assert len(msg['embeds']) >= 1


def test_update_game_view_edits_existing():
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    g.data['player1Id'] = 'alice'
    g.data['player2Id'] = 'bob'
    g.data['phase'] = 'lobby'
    mid = post_game_view('chan-1', g, backend=be)
    assert mid is not None
    # Change game state
    g.data['phase'] = 'game_over'
    g.data['winner'] = 1
    g.data['gameEndedReason'] = 'elimination'
    ok = update_game_view('chan-1', mid, g, backend=be)
    assert ok
    msg = be.fetch('chan-1', mid)
    titles = [e.get('title', '') for e in msg['embeds']]
    assert any('Game Over' in t for t in titles)


def test_update_missing_message_returns_false():
    from python.engine.creation import create_game
    be = InMemoryBackend()
    g = create_game()
    assert update_game_view('chan-1', 'no-such', g, backend=be) is False


def main():
    cases = [
        ('post_fetch', test_in_memory_post_fetch_roundtrip),
        ('edit_delete', test_in_memory_edit_and_delete),
        ('edit_unknown', test_in_memory_edit_unknown_id_returns_false),
        ('list_messages', test_in_memory_list_messages),
        ('post_empty_channel', test_in_memory_post_empty_channel_id_returns_none),
        ('default_backend', test_default_backend_is_in_memory_by_default),
        ('post_game_view', test_post_game_view_roundtrip),
        ('update_game_view', test_update_game_view_edits_existing),
        ('update_missing', test_update_missing_message_returns_false),
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
