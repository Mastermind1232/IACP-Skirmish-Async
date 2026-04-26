"""Achievements engine — port of src/db.js achievements section.

Two pieces:
  - ACHIEVEMENT_SEED: 17 hardcoded achievement defs (name, icon, trigger,
    threshold).
  - seed_achievements(store): upsert all defs into achievement_defs at
    bot startup.
  - check_and_grant_achievements(store, user_id, trigger, stat_count):
    insert any newly-earned achievements into user_achievements and
    return the def list so the bot can post a notification.

Triggers (set when the bot calls check_and_grant after a relevant
event):
  - 'game_complete' — after any finished game (stat_count = total games)
  - 'game_win' — after a win (stat_count = total wins)
  - 'single_attack_damage' — when an attack deals N+ damage
  - 'activation_kills' — when an activation defeats N+ figures
  - 'shutout_win' — won, opponent scored 0 VP (stat_count always 1)
  - 'no_losses_win' — won without losing any figures (stat_count 1)
  - 'full_wipe_win' — won by eliminating all opponent figures (1)
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

_LOG = logging.getLogger('skirbo.achievements')


ACHIEVEMENT_SEED: List[Dict[str, Any]] = [
    # Games played milestones
    {'id': 'complete_1_game',   'name': 'New Recruit',
     'description': 'Complete your first game',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 1},
    {'id': 'complete_5_games',  'name': 'Field Tested',
     'description': 'Complete 5 games',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 5},
    {'id': 'complete_10_games', 'name': 'Battle-Hardened',
     'description': 'Complete 10 games',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 10},
    {'id': 'complete_25_games', 'name': 'Veteran of the Outer Rim',
     'description': 'Complete 25 games',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 25},
    {'id': 'complete_50_games', 'name': 'Galactic Campaigner',
     'description': 'Complete 50 games',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 50},
    {'id': 'complete_100_games', 'name': 'Legend of the Empire',
     'description': 'Complete 100 games',
     'icon': '🏆', 'trigger': 'game_complete', 'threshold': 100},
    # Win milestones
    {'id': 'win_1_game',  'name': 'A New Hope',
     'description': 'Win your first game',
     'icon': '🥇', 'trigger': 'game_win', 'threshold': 1},
    {'id': 'win_5_games', 'name': 'Rising Force',
     'description': 'Win 5 games',
     'icon': '🥇', 'trigger': 'game_win', 'threshold': 5},
    {'id': 'win_10_games', 'name': 'Rebel Commander',
     'description': 'Win 10 games',
     'icon': '🥇', 'trigger': 'game_win', 'threshold': 10},
    {'id': 'win_25_games', 'name': 'Grand Admiral',
     'description': 'Win 25 games',
     'icon': '🥇', 'trigger': 'game_win', 'threshold': 25},
    {'id': 'win_50_games', 'name': 'The Chosen One',
     'description': 'Win 50 games',
     'icon': '🥇', 'trigger': 'game_win', 'threshold': 50},
    # In-game highlights
    {'id': 'devastator', 'name': 'Devastator',
     'description': 'Deal 10+ damage in a single attack',
     'icon': '💥', 'trigger': 'single_attack_damage', 'threshold': 10},
    {'id': 'double_kill', 'name': 'Double Kill',
     'description': 'Defeat 2 figures in a single activation',
     'icon': '⚔️', 'trigger': 'activation_kills', 'threshold': 2},
    {'id': 'triple_kill', 'name': 'Triple Kill',
     'description': 'Defeat 3 figures in a single activation',
     'icon': '⚔️', 'trigger': 'activation_kills', 'threshold': 3},
    {'id': 'pentakill', 'name': 'PENTAKILL',
     'description': 'Defeat 5 figures in a single activation',
     'icon': '💀', 'trigger': 'activation_kills', 'threshold': 5},
    # Game-end conditions
    {'id': 'shutout', 'name': 'Shutout',
     'description': 'Win a game where your opponent scored 0 VP',
     'icon': '🔒', 'trigger': 'shutout_win', 'threshold': 1},
    {'id': 'survivor', 'name': 'Survivor',
     'description': 'Win a game without losing any figures',
     'icon': '🛡️', 'trigger': 'no_losses_win', 'threshold': 1},
    {'id': 'brutalist', 'name': 'Brutalist',
     'description': 'Win by eliminating all opponent figures',
     'icon': '☠️', 'trigger': 'full_wipe_win', 'threshold': 1},
]


# ---------------------------------------------------------------------------
# DB helpers


def _engine_or_none(store: Any) -> Any:
    if store is None or not hasattr(store, '_ensure_engine'):
        return None
    try:
        store._ensure_engine()
    except Exception:
        return None
    return getattr(store, '_engine', None)


def _ensure_tables(engine: Any) -> bool:
    """Create achievement_defs + user_achievements if missing."""
    try:
        from sqlalchemy import (  # type: ignore[import]
            Column, DateTime, ForeignKey, Integer, MetaData, String, Table,
            UniqueConstraint, func,
        )
        with engine.begin() as conn:
            conn.execute(
                __import__('sqlalchemy').text(
                    """
                    CREATE TABLE IF NOT EXISTS achievement_defs (
                      id TEXT PRIMARY KEY,
                      name TEXT NOT NULL,
                      description TEXT NOT NULL,
                      icon TEXT DEFAULT '🏆',
                      trigger TEXT NOT NULL,
                      threshold INT NOT NULL DEFAULT 1
                    )
                    """
                )
            )
            conn.execute(
                __import__('sqlalchemy').text(
                    """
                    CREATE TABLE IF NOT EXISTS user_achievements (
                      id SERIAL PRIMARY KEY,
                      user_id TEXT NOT NULL,
                      achievement_id TEXT NOT NULL
                        REFERENCES achievement_defs(id),
                      earned_at TIMESTAMPTZ DEFAULT NOW(),
                      UNIQUE(user_id, achievement_id)
                    )
                    """
                )
            )
        return True
    except Exception as e:
        _LOG.warning('achievement table create failed: %s', e)
        return False


def seed_achievements(store: Any) -> int:
    """Upsert ACHIEVEMENT_SEED into the achievement_defs table.
    Returns count of definitions seeded. No-op when no DB pool.
    """
    engine = _engine_or_none(store)
    if engine is None:
        return 0
    if not _ensure_tables(engine):
        return 0
    try:
        from sqlalchemy import text  # type: ignore[import]
        seeded = 0
        with engine.begin() as conn:
            for d in ACHIEVEMENT_SEED:
                conn.execute(
                    text(
                        """
                        INSERT INTO achievement_defs (id, name, description,
                                                       icon, trigger, threshold)
                        VALUES (:id, :name, :description, :icon, :trigger,
                                :threshold)
                        ON CONFLICT (id) DO UPDATE
                          SET name = EXCLUDED.name,
                              description = EXCLUDED.description,
                              icon = EXCLUDED.icon,
                              trigger = EXCLUDED.trigger,
                              threshold = EXCLUDED.threshold
                        """
                    ),
                    d,
                )
                seeded += 1
        return seeded
    except Exception as e:
        _LOG.warning('seed_achievements failed: %s', e)
        return 0


def check_and_grant_achievements(store: Any, user_id: str,
                                  trigger: str, stat_count: int
                                  ) -> List[Dict[str, Any]]:
    """Insert any achievement_defs matching `trigger` with
    threshold ≤ stat_count into user_achievements. Returns the list
    of newly-granted defs (name, description, icon).
    """
    engine = _engine_or_none(store)
    if engine is None:
        return []
    try:
        from sqlalchemy import text  # type: ignore[import]
        with engine.begin() as conn:
            granted_rows = conn.execute(
                text(
                    """
                    INSERT INTO user_achievements (user_id, achievement_id)
                    SELECT :uid, d.id
                      FROM achievement_defs d
                      WHERE d.trigger = :trigger
                        AND d.threshold <= :n
                    ON CONFLICT (user_id, achievement_id) DO NOTHING
                    RETURNING achievement_id
                    """
                ),
                {'uid': str(user_id), 'trigger': trigger, 'n': int(stat_count)},
            ).fetchall()
            granted_ids = [r[0] for r in granted_rows]
            if not granted_ids:
                return []
            defs_rows = conn.execute(
                text(
                    'SELECT id, name, description, icon FROM achievement_defs '
                    'WHERE id = ANY(:ids)'
                ),
                {'ids': granted_ids},
            ).fetchall()
            return [
                {'id': r[0], 'name': r[1], 'description': r[2], 'icon': r[3]}
                for r in defs_rows
            ]
    except Exception as e:
        _LOG.warning('check_and_grant_achievements failed: %s', e)
        return []
