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

    # ── completed_games — stats history ────────────────────────────────────

    def _ensure_completed_table(self):
        """Lazy-create the completed_games table (matches JS schema)."""
        try:
            from sqlalchemy import (  # type: ignore[import]
                Column, DateTime, Integer, MetaData, String, Table, func,
            )
            from sqlalchemy.dialects.postgresql import JSONB  # type: ignore[import]
        except ImportError as e:
            raise RuntimeError(
                'PostgresStore requires sqlalchemy + psycopg: pip install '
                'sqlalchemy psycopg'
            ) from e
        if getattr(self, '_completed_table', None) is not None:
            return self._completed_table
        self._ensure_engine()
        completed = Table(
            'completed_games', self._metadata,
            Column('id', Integer, primary_key=True, autoincrement=True),
            Column('game_id', String),
            Column('winner_id', String),
            Column('player1_id', String, nullable=False),
            Column('player2_id', String, nullable=False),
            Column('player1_affiliation', String),
            Column('player2_affiliation', String),
            Column('player1_army_json', JSONB),
            Column('player2_army_json', JSONB),
            Column('map_id', String),
            Column('mission_id', String),
            Column('deployment_zone_winner', String),
            Column('ended_at', DateTime(timezone=True),
                   server_default=func.now()),
            Column('round_count', Integer),
            extend_existing=True,
        )
        completed.create(self._engine, checkfirst=True)
        self._completed_table = completed
        return completed

    def insert_completed_game(self, game: GameState) -> bool:
        """Write a completed-games row when a game ends.

        Mirrors src/db.js:insertCompletedGame byte-for-byte.
        Returns True on insert, False if the game didn't signal a completion.
        """
        data = game.data if hasattr(game, 'data') else game
        if not (data.get('ended') or data.get('phase') == 'game_over'):
            return False
        try:
            completed = self._ensure_completed_table()
            p1_squad = data.get('player1Squad') or {}
            p2_squad = data.get('player2Squad') or {}
            map_info = data.get('selectedMap') or {}
            mission = data.get('selectedMission') or {}
            map_id = map_info.get('id')
            mission_id = (
                f'{map_id or ""}:{mission.get("variant", "a")}'
                if mission else None
            )
            winner_num = data.get('winner')
            winner_id = None
            if winner_num == 1:
                winner_id = data.get('player1Id')
            elif winner_num == 2:
                winner_id = data.get('player2Id')
            else:
                winner_id = data.get('winnerId')
            deployment_zone_winner = None
            if data.get('deploymentZoneChosen'):
                init_holder = data.get('initiativeHolder')
                if init_holder == 1:
                    deployment_zone_winner = data.get('player1Id')
                elif init_holder == 2:
                    deployment_zone_winner = data.get('player2Id')

            stmt = completed.insert().values(
                game_id=data.get('gameId'),
                winner_id=winner_id,
                player1_id=str(data.get('player1Id') or ''),
                player2_id=str(data.get('player2Id') or ''),
                player1_affiliation=p1_squad.get('affiliation'),
                player2_affiliation=p2_squad.get('affiliation'),
                player1_army_json=p1_squad,
                player2_army_json=p2_squad,
                map_id=map_id,
                mission_id=mission_id,
                deployment_zone_winner=deployment_zone_winner,
                round_count=data.get('currentRound') or data.get('round'),
            )
            with self._engine.begin() as conn:
                conn.execute(stmt)
            return True
        except Exception as e:  # noqa: BLE001
            import logging
            logging.getLogger('skirbo.db').warning(
                'insert_completed_game failed: %s', e,
            )
            return False

    def get_total_games(self) -> Dict[str, int]:
        """Return {total, draws} from completed_games."""
        try:
            completed = self._ensure_completed_table()
            from sqlalchemy import func, select  # type: ignore[import]
            with self._engine.connect() as conn:
                total = conn.execute(
                    select(func.count()).select_from(completed),
                ).scalar() or 0
                draws = conn.execute(
                    select(func.count()).select_from(completed)
                    .where(completed.c.winner_id.is_(None)),
                ).scalar() or 0
            return {'total': int(total), 'draws': int(draws)}
        except Exception:
            return {'total': 0, 'draws': 0}


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
