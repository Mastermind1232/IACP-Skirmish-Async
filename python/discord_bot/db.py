"""Game persistence layer — mirror of src/db.js.

Provides a GameStore interface with three implementations:
  - InMemoryStore: dict-backed, fast, no persistence (test + dev)
  - JsonFileStore: single-file JSON backing (single-process hobbyist mode)
  - PostgresStore: SQLAlchemy-backed (production, Railway)

The interface is minimal enough that the router only needs get / save.
The bot's build_deps() picks one based on env configuration.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Protocol

from python.engine.state import GameState


class GameStore(Protocol):
    """Interface every game store implements."""
    def get(self, game_id: str) -> Optional[GameState]: ...
    def save(self, game_id: str, game: GameState) -> None: ...
    def delete(self, game_id: str) -> None: ...
    def list_ids(self) -> List[str]: ...


# ── In-memory store ────────────────────────────────────────────────────────

class InMemoryStore:
    """Dict-backed game store. No persistence; resets on process restart."""

    def __init__(self) -> None:
        self._games: Dict[str, GameState] = {}

    def get(self, game_id: str) -> Optional[GameState]:
        return self._games.get(game_id)

    def save(self, game_id: str, game: GameState) -> None:
        self._games[game_id] = game

    def delete(self, game_id: str) -> None:
        self._games.pop(game_id, None)

    def list_ids(self) -> List[str]:
        return sorted(self._games.keys())

    def __len__(self) -> int:
        return len(self._games)


# ── JSON file store ────────────────────────────────────────────────────────

class JsonFileStore:
    """Single-file JSON game store. Serializes all games to one .json file.

    Atomic writes via tempfile + rename. Suitable for single-process
    hobbyist mode. Production should use PostgresStore.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._cache: Dict[str, GameState] = {}
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        if self.path.exists():
            try:
                with self.path.open('r') as f:
                    raw = json.load(f)
                if isinstance(raw, dict):
                    for gid, data in raw.items():
                        if isinstance(data, dict):
                            self._cache[gid] = GameState(data)
            except (json.JSONDecodeError, OSError):
                # Corrupt file → start fresh; caller can backup manually.
                self._cache = {}
        self._loaded = True

    def get(self, game_id: str) -> Optional[GameState]:
        self._ensure_loaded()
        return self._cache.get(game_id)

    def save(self, game_id: str, game: GameState) -> None:
        self._ensure_loaded()
        self._cache[game_id] = game
        self._flush()

    def delete(self, game_id: str) -> None:
        self._ensure_loaded()
        self._cache.pop(game_id, None)
        self._flush()

    def list_ids(self) -> List[str]:
        self._ensure_loaded()
        return sorted(self._cache.keys())

    def _flush(self) -> None:
        payload = {gid: g.data for gid, g in self._cache.items()}
        # Atomic write: temp file + rename
        fd, tmp_path = tempfile.mkstemp(prefix='skirbo-games-',
                                        dir=self.path.parent, suffix='.json.tmp')
        try:
            with os.fdopen(fd, 'w') as f:
                json.dump(payload, f, default=_json_default)
            os.replace(tmp_path, self.path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise


def _json_default(o: Any) -> Any:
    if hasattr(o, 'value'):
        return o.value
    if hasattr(o, '__dict__'):
        return o.__dict__
    raise TypeError(f'not JSON serializable: {type(o).__name__}')


# ── Postgres store (lazy — requires SQLAlchemy) ────────────────────────────

class PostgresStore:
    """SQLAlchemy-backed game store targeting Postgres.

    Schema (matches the existing JS src/db.js schema byte-for-byte, so
    the Python bot can read games saved by the Node bot without
    migration):

        games (
          game_id TEXT PRIMARY KEY,
          game_data JSONB NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )

    sqlalchemy + psycopg are imported lazily so tests don't require them.
    Use InMemoryStore or JsonFileStore for environments without a DB.
    """

    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._engine = None
        self._metadata = None
        self._table = None

    def _ensure_engine(self) -> None:
        if self._engine is not None:
            return
        try:
            from sqlalchemy import (  # type: ignore[import]
                Column, DateTime, MetaData, String, Table, create_engine, func,
            )
            from sqlalchemy.dialects.postgresql import JSONB  # type: ignore[import]
        except ImportError as e:
            raise RuntimeError(
                'PostgresStore requires sqlalchemy + psycopg: pip install '
                'sqlalchemy psycopg'
            ) from e
        self._engine = create_engine(self.dsn)
        self._metadata = MetaData()
        self._table = Table(
            'games', self._metadata,
            # Column names match the existing JS schema verbatim.
            Column('game_id', String, primary_key=True),
            Column('game_data', JSONB, nullable=False),
            Column('updated_at', DateTime(timezone=True),
                   server_default=func.now()),
        )
        self._metadata.create_all(self._engine)

    def get(self, game_id: str) -> Optional[GameState]:
        self._ensure_engine()
        from sqlalchemy import select  # type: ignore[import]
        stmt = select(self._table.c.game_data).where(
            self._table.c.game_id == game_id,
        )
        with self._engine.connect() as conn:
            row = conn.execute(stmt).first()
        if not row:
            return None
        data = row[0]
        if isinstance(data, dict):
            return GameState(data)
        return None

    def save(self, game_id: str, game: GameState) -> None:
        self._ensure_engine()
        from sqlalchemy.dialects.postgresql import insert  # type: ignore[import]
        payload = {'game_id': game_id, 'game_data': game.data}
        stmt = insert(self._table).values(**payload)
        stmt = stmt.on_conflict_do_update(
            index_elements=['game_id'],
            set_={'game_data': payload['game_data']},
        )
        with self._engine.begin() as conn:
            conn.execute(stmt)

    def delete(self, game_id: str) -> None:
        self._ensure_engine()
        with self._engine.begin() as conn:
            conn.execute(
                self._table.delete().where(self._table.c.game_id == game_id)
            )

    def list_ids(self) -> List[str]:
        self._ensure_engine()
        from sqlalchemy import select  # type: ignore[import]
        stmt = select(self._table.c.game_id).order_by(self._table.c.game_id)
        with self._engine.connect() as conn:
            return [row[0] for row in conn.execute(stmt)]


# ── Factory: pick by env ──────────────────────────────────────────────────

def make_store(env: Optional[Dict[str, str]] = None) -> GameStore:
    """Construct a store based on env config.

    Priority:
      1. DATABASE_URL (postgres://...) → PostgresStore
      2. SKIRBO_GAMES_PATH (file path) → JsonFileStore
      3. fallback → InMemoryStore
    """
    env = env if env is not None else os.environ
    if env.get('DATABASE_URL'):
        return PostgresStore(env['DATABASE_URL'])
    if env.get('SKIRBO_GAMES_PATH'):
        return JsonFileStore(env['SKIRBO_GAMES_PATH'])
    return InMemoryStore()
