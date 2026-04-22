"""Tests for the game-store layer (in-memory + JSON file)."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from python.discord_bot.db import (
    InMemoryStore, JsonFileStore, make_store,
)
from python.engine.state import GameState


def test_in_memory_roundtrip():
    s = InMemoryStore()
    g = GameState({'round': 1, 'activePlayer': 1})
    s.save('abc', g)
    r = s.get('abc')
    assert r is not None
    assert r.data == {'round': 1, 'activePlayer': 1}


def test_in_memory_get_missing_returns_none():
    s = InMemoryStore()
    assert s.get('nope') is None


def test_in_memory_delete():
    s = InMemoryStore()
    s.save('abc', GameState({'round': 1}))
    assert s.get('abc') is not None
    s.delete('abc')
    assert s.get('abc') is None


def test_in_memory_list_ids_sorted():
    s = InMemoryStore()
    s.save('c', GameState({}))
    s.save('a', GameState({}))
    s.save('b', GameState({}))
    assert s.list_ids() == ['a', 'b', 'c']


def test_json_file_store_roundtrip_persists_across_instances():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'games.json'
        s1 = JsonFileStore(path)
        s1.save('g1', GameState({'round': 3, 'vp': 7}))
        # Re-open: a fresh store instance should see the saved data
        s2 = JsonFileStore(path)
        r = s2.get('g1')
        assert r is not None
        assert r.data == {'round': 3, 'vp': 7}


def test_json_file_store_delete_persists():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'games.json'
        s1 = JsonFileStore(path)
        s1.save('g1', GameState({'a': 1}))
        s1.save('g2', GameState({'b': 2}))
        s1.delete('g1')
        s2 = JsonFileStore(path)
        assert s2.get('g1') is None
        assert s2.get('g2') is not None


def test_json_file_store_corrupt_file_starts_fresh():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'games.json'
        # Write intentionally broken JSON
        path.write_text('{corrupt json')
        s = JsonFileStore(path)
        assert s.get('anything') is None
        # Saving a new game works
        s.save('g1', GameState({'ok': True}))
        s2 = JsonFileStore(path)
        r = s2.get('g1')
        assert r is not None
        assert r.data == {'ok': True}


def test_json_file_store_atomic_write_flush_creates_file():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'games.json'
        s = JsonFileStore(path)
        s.save('g1', GameState({'x': 1}))
        assert path.exists()
        raw = json.loads(path.read_text())
        assert raw == {'g1': {'x': 1}}


def test_make_store_defaults_to_in_memory():
    s = make_store({})
    assert isinstance(s, InMemoryStore)


def test_make_store_json_when_path_env_set():
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / 'games.json'
        s = make_store({'SKIRBO_GAMES_PATH': str(path)})
        assert isinstance(s, JsonFileStore)
        s.save('g', GameState({'v': 1}))
        assert path.exists()


def main():
    cases = [
        ('in_memory_roundtrip', test_in_memory_roundtrip),
        ('in_memory_missing', test_in_memory_get_missing_returns_none),
        ('in_memory_delete', test_in_memory_delete),
        ('in_memory_list_ids', test_in_memory_list_ids_sorted),
        ('json_file_persists', test_json_file_store_roundtrip_persists_across_instances),
        ('json_file_delete_persists', test_json_file_store_delete_persists),
        ('json_file_corrupt_fresh', test_json_file_store_corrupt_file_starts_fresh),
        ('json_file_atomic_write', test_json_file_store_atomic_write_flush_creates_file),
        ('make_store_default_inmemory', test_make_store_defaults_to_in_memory),
        ('make_store_json_path', test_make_store_json_when_path_env_set),
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
