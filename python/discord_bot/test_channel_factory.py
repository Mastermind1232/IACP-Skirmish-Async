"""Tests for channel_factory — per-game channel/thread creation.

Run: python3 python/discord_bot/test_channel_factory.py
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.channel_factory import (
    InMemoryFactoryBackend,
    _safe_slug,
    create_game_channels,
    get_default_factory,
    set_default_factory,
)


def test_safe_slug_basic():
    assert _safe_slug('Alice Wonder') == 'alice-wonder'
    assert _safe_slug('Bob_42!', max_len=8) == 'bob-42'
    assert _safe_slug('') == 'player'
    assert _safe_slug('123456789012345678', max_len=10) == '1234567890'


def test_in_memory_create_text_channel():
    be = InMemoryFactoryBackend()
    cid = be.create_text_channel('guild-1', 'test-chan')
    assert cid is not None
    assert len(be.channels) == 1
    assert be.channels[0]['name'] == 'test-chan'


def test_in_memory_create_thread():
    be = InMemoryFactoryBackend()
    cid = be.create_text_channel('guild-1', 'parent')
    tid = be.create_thread(cid, 'my-thread', private=True)
    assert tid is not None
    assert len(be.threads) == 1
    assert be.threads[0]['parent_channel_id'] == cid
    assert be.threads[0]['private'] is True


def test_in_memory_empty_args_return_none():
    be = InMemoryFactoryBackend()
    assert be.create_text_channel('', 'chan') is None
    assert be.create_text_channel('guild', '') is None
    assert be.create_thread('', 'thread') is None


def test_create_game_channels_full_set():
    be = InMemoryFactoryBackend()
    ids = create_game_channels('G-123', 'guild-1', 'alice', 'bob',
                                 backend=be)
    # All 6 fields must be non-None on a successful set.
    assert ids['board_channel_id'] is not None
    assert ids['log_channel_id'] is not None
    assert ids['p1_play_area_channel_id'] is not None
    assert ids['p2_play_area_channel_id'] is not None
    assert ids['p1_hand_channel_id'] is not None
    assert ids['p2_hand_channel_id'] is not None
    # 4 channels + 2 threads
    assert len(be.channels) == 4
    assert len(be.threads) == 2


def test_create_game_channels_uses_prefix():
    be = InMemoryFactoryBackend()
    ids = create_game_channels('G-abc', 'guild-1', 'alice', 'bob',
                                 prefix='myprefix', backend=be)
    assert ids['board_channel_id'] is not None
    names = [c['name'] for c in be.channels]
    assert all(n.startswith('myprefix-') for n in names)


def test_default_factory_is_in_memory():
    set_default_factory(InMemoryFactoryBackend())
    assert isinstance(get_default_factory(), InMemoryFactoryBackend)


def main():
    cases = [
        ('safe_slug', test_safe_slug_basic),
        ('create_text', test_in_memory_create_text_channel),
        ('create_thread', test_in_memory_create_thread),
        ('empty_args', test_in_memory_empty_args_return_none),
        ('full_set', test_create_game_channels_full_set),
        ('prefix', test_create_game_channels_uses_prefix),
        ('default_factory', test_default_factory_is_in_memory),
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
