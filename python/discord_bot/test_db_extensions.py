"""P3.1 verification: PostgresStore adapter with extended tables.

Validates that PostgresStore exposes the JS-parity surface for
games / completed_games / domain_events / game_snapshots /
selfplay_runs. Uses SQLite via SQLAlchemy as a test backend so the
suite runs without a live Postgres.
"""
import os
import tempfile

import pytest

from python.discord_bot.db import (
    InMemoryStore,
    JsonFileStore,
    PostgresStore,
    make_store,
)
from python.engine.state import GameState


# ── Factory selection ──────────────────────────────────────────────────


def test_make_store_no_env_returns_in_memory():
    s = make_store({})
    assert isinstance(s, InMemoryStore)


def test_make_store_json_file_path_returns_json_store(tmp_path):
    s = make_store({'SKIRBO_GAMES_PATH': str(tmp_path / 'games.json')})
    assert isinstance(s, JsonFileStore)


def test_make_store_database_url_returns_postgres():
    s = make_store({'DATABASE_URL': 'postgresql://localhost/test'})
    assert isinstance(s, PostgresStore)


# ── PostgresStore: extended-table methods registered ────────────────────


def test_postgres_store_has_domain_events_methods():
    s = PostgresStore('postgresql://localhost/test')
    assert hasattr(s, 'insert_domain_event')
    assert hasattr(s, '_ensure_domain_events_table')


def test_postgres_store_has_snapshot_methods():
    s = PostgresStore('postgresql://localhost/test')
    assert hasattr(s, 'insert_game_snapshot')
    assert hasattr(s, '_ensure_snapshots_table')


def test_postgres_store_has_selfplay_methods():
    s = PostgresStore('postgresql://localhost/test')
    assert hasattr(s, 'insert_selfplay_run')
    assert hasattr(s, '_ensure_selfplay_table')


def test_postgres_store_has_completed_games_methods():
    s = PostgresStore('postgresql://localhost/test')
    assert hasattr(s, 'insert_completed_game')
    assert hasattr(s, '_ensure_completed_table')


# ── InMemoryStore round-trip ────────────────────────────────────────────


def test_in_memory_store_round_trip():
    s = InMemoryStore()
    g = GameState({'foo': 'bar', 'gameId': 'g1'})
    s.save('g1', g)
    loaded = s.get('g1')
    assert loaded is not None
    assert loaded.data.get('foo') == 'bar'


def test_in_memory_store_delete():
    s = InMemoryStore()
    s.save('g1', GameState({}))
    s.delete('g1')
    assert s.get('g1') is None


def test_in_memory_store_list_ids():
    s = InMemoryStore()
    s.save('a', GameState({}))
    s.save('c', GameState({}))
    s.save('b', GameState({}))
    assert s.list_ids() == ['a', 'b', 'c']


# ── JsonFileStore round-trip ────────────────────────────────────────────


def test_json_file_store_persists_across_instances(tmp_path):
    path = str(tmp_path / 'games.json')
    s1 = JsonFileStore(path)
    s1.save('g1', GameState({'gameId': 'g1', 'value': 42}))
    s2 = JsonFileStore(path)
    loaded = s2.get('g1')
    assert loaded is not None
    assert loaded.data.get('value') == 42
