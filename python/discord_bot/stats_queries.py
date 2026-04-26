"""Stats DB queries — port of src/db.js stats functions.

Reads completed_games + user_achievements via the PostgresStore's
SQLAlchemy engine. All functions return plain dicts / lists that the
slash-command layer formats into Discord embeds.

Each function gracefully returns empty defaults when:
  - No DB pool is configured (in-memory / JSON store).
  - The query raises (connection, schema mismatch).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

_LOG = logging.getLogger('skirbo.stats')


def _engine_or_none(store: Any) -> Any:
    """Return the SQLAlchemy engine from a PostgresStore, or None."""
    if store is None:
        return None
    if not hasattr(store, '_ensure_engine'):
        return None
    try:
        store._ensure_engine()
    except Exception:
        return None
    return getattr(store, '_engine', None)


def _query(store: Any, sql: str, params: Optional[Dict[str, Any]] = None
           ) -> List[Dict[str, Any]]:
    """Run SQL and return list of row dicts. Empty list on any failure."""
    engine = _engine_or_none(store)
    if engine is None:
        return []
    try:
        from sqlalchemy import text  # type: ignore[import]
        with engine.connect() as conn:
            result = conn.execute(text(sql), params or {})
            return [dict(r._mapping) for r in result]
    except Exception as e:
        _LOG.warning('stats query failed: %s — %s', sql.split()[0], e)
        return []


def get_stats_summary(store: Any) -> Dict[str, int]:
    rows = _query(store, 'SELECT COUNT(*)::int AS n FROM completed_games')
    total = int(rows[0]['n']) if rows else 0
    rows = _query(store,
                  'SELECT COUNT(*)::int AS n FROM completed_games '
                  'WHERE winner_id IS NULL')
    draws = int(rows[0]['n']) if rows else 0
    return {'totalGames': total, 'draws': draws}


def get_affiliation_win_rates(store: Any) -> List[Dict[str, Any]]:
    sql = """
    SELECT
      aff AS affiliation,
      SUM(wins)::int AS wins,
      SUM(games)::int AS games,
      ROUND(100.0 * SUM(wins) / NULLIF(SUM(games), 0), 1) AS win_rate
    FROM (
      SELECT player1_affiliation AS aff,
             (winner_id = player1_id)::int AS wins, 1 AS games
      FROM completed_games
      WHERE winner_id IS NOT NULL AND player1_affiliation IS NOT NULL
      UNION ALL
      SELECT player2_affiliation AS aff,
             (winner_id = player2_id)::int AS wins, 1 AS games
      FROM completed_games
      WHERE winner_id IS NOT NULL AND player2_affiliation IS NOT NULL
    ) t
    GROUP BY aff
    ORDER BY SUM(games) DESC
    """
    rows = _query(store, sql)
    return [
        {
            'affiliation': r['affiliation'],
            'wins': int(r['wins'] or 0),
            'games': int(r['games'] or 0),
            'winRate': float(r['win_rate']) if r.get('win_rate') is not None else 0.0,
        }
        for r in rows
    ]


def get_affiliation_pick_rates(store: Any) -> List[Dict[str, Any]]:
    sql = """
    SELECT aff AS affiliation, COUNT(*)::int AS picks FROM (
      SELECT player1_affiliation AS aff FROM completed_games
       WHERE player1_affiliation IS NOT NULL
      UNION ALL
      SELECT player2_affiliation AS aff FROM completed_games
       WHERE player2_affiliation IS NOT NULL
    ) t
    GROUP BY aff
    ORDER BY COUNT(*) DESC
    """
    rows = _query(store, sql)
    total = sum(int(r['picks'] or 0) for r in rows) or 1
    return [
        {
            'affiliation': r['affiliation'],
            'picks': int(r['picks'] or 0),
            'pickRate': round(100.0 * int(r['picks'] or 0) / total, 1),
        }
        for r in rows
    ]


def get_dc_win_rates(store: Any, limit: int = 20) -> List[Dict[str, Any]]:
    rows = _query(
        store,
        'SELECT player1_army_json, player2_army_json, winner_id, '
        'player1_id, player2_id FROM completed_games '
        'WHERE winner_id IS NOT NULL',
    )
    by_dc: Dict[str, Dict[str, int]] = {}
    for row in rows:
        p1 = row.get('player1_army_json') or {}
        p2 = row.get('player2_army_json') or {}
        p1_won = row.get('winner_id') == row.get('player1_id')
        p2_won = row.get('winner_id') == row.get('player2_id')
        for army, won in ((p1, p1_won), (p2, p2_won)):
            if not isinstance(army, dict):
                continue
            for dc in army.get('dcList') or []:
                if isinstance(dc, str):
                    name = dc
                elif isinstance(dc, dict):
                    name = dc.get('displayName') or dc.get('name') or ''
                else:
                    name = ''
                if not name:
                    continue
                by_dc.setdefault(name, {'wins': 0, 'games': 0})
                by_dc[name]['games'] += 1
                if won:
                    by_dc[name]['wins'] += 1
    out = [
        {
            'dcName': name,
            'wins': v['wins'],
            'games': v['games'],
            'winRate': round(100.0 * v['wins'] / v['games'], 1) if v['games'] else 0.0,
        }
        for name, v in by_dc.items()
    ]
    out.sort(key=lambda x: x['games'], reverse=True)
    return out[:limit]


def get_leaderboard(store: Any, limit: int = 10) -> List[Dict[str, Any]]:
    sql = """
    SELECT
      player_id,
      SUM(wins)::int AS wins,
      SUM(games)::int AS games
    FROM (
      SELECT player1_id AS player_id,
             (winner_id = player1_id)::int AS wins, 1 AS games
      FROM completed_games WHERE winner_id IS NOT NULL
      UNION ALL
      SELECT player2_id AS player_id,
             (winner_id = player2_id)::int AS wins, 1 AS games
      FROM completed_games WHERE winner_id IS NOT NULL
    ) t
    GROUP BY player_id
    HAVING SUM(games) >= 5
    ORDER BY (SUM(wins)::float / NULLIF(SUM(games), 0)) DESC
    LIMIT :lim
    """
    rows = _query(store, sql, {'lim': int(limit)})
    return [
        {
            'playerId': r['player_id'],
            'wins': int(r['wins'] or 0),
            'games': int(r['games'] or 0),
            'winRate': round(
                100.0 * int(r['wins'] or 0) / max(int(r['games'] or 0), 1), 1,
            ),
        }
        for r in rows
    ]


def get_stats_summary_for_player(store: Any, user_id: str) -> Dict[str, int]:
    sql = """
    SELECT
      COUNT(*)::int AS games,
      SUM(CASE WHEN winner_id = :uid THEN 1 ELSE 0 END)::int AS wins,
      SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END)::int AS draws
    FROM completed_games
    WHERE player1_id = :uid OR player2_id = :uid
    """
    rows = _query(store, sql, {'uid': str(user_id)})
    if not rows:
        return {'games': 0, 'wins': 0, 'losses': 0, 'draws': 0, 'winRate': 0}
    r = rows[0]
    games = int(r.get('games') or 0)
    wins = int(r.get('wins') or 0)
    draws = int(r.get('draws') or 0)
    losses = games - wins - draws
    return {
        'games': games, 'wins': wins, 'losses': losses, 'draws': draws,
        'winRate': round(100.0 * wins / games, 1) if games else 0,
    }


def get_affiliation_win_rates_personal(store: Any, user_id: str
                                        ) -> List[Dict[str, Any]]:
    sql = """
    SELECT
      aff AS affiliation,
      SUM(wins)::int AS wins,
      SUM(games)::int AS games
    FROM (
      SELECT player1_affiliation AS aff,
             (winner_id = :uid)::int AS wins, 1 AS games
      FROM completed_games
      WHERE player1_id = :uid AND winner_id IS NOT NULL
      UNION ALL
      SELECT player2_affiliation AS aff,
             (winner_id = :uid)::int AS wins, 1 AS games
      FROM completed_games
      WHERE player2_id = :uid AND winner_id IS NOT NULL
    ) t
    WHERE aff IS NOT NULL
    GROUP BY aff
    ORDER BY SUM(games) DESC
    """
    rows = _query(store, sql, {'uid': str(user_id)})
    return [
        {
            'affiliation': r['affiliation'],
            'wins': int(r['wins'] or 0),
            'games': int(r['games'] or 0),
            'winRate': round(
                100.0 * int(r['wins'] or 0) / max(int(r['games'] or 0), 1), 1,
            ),
        }
        for r in rows
    ]


def get_affiliation_pick_rates_personal(store: Any, user_id: str
                                         ) -> List[Dict[str, Any]]:
    sql = """
    SELECT aff AS affiliation, COUNT(*)::int AS picks FROM (
      SELECT player1_affiliation AS aff FROM completed_games
       WHERE player1_id = :uid AND player1_affiliation IS NOT NULL
      UNION ALL
      SELECT player2_affiliation AS aff FROM completed_games
       WHERE player2_id = :uid AND player2_affiliation IS NOT NULL
    ) t
    GROUP BY aff
    ORDER BY COUNT(*) DESC
    """
    rows = _query(store, sql, {'uid': str(user_id)})
    total = sum(int(r['picks'] or 0) for r in rows) or 1
    return [
        {
            'affiliation': r['affiliation'],
            'picks': int(r['picks'] or 0),
            'pickRate': round(100.0 * int(r['picks'] or 0) / total, 1),
        }
        for r in rows
    ]


def get_dc_win_rates_personal(store: Any, user_id: str, limit: int = 20
                               ) -> List[Dict[str, Any]]:
    rows = _query(
        store,
        'SELECT player1_army_json, player2_army_json, winner_id, '
        'player1_id, player2_id FROM completed_games '
        'WHERE (player1_id = :uid OR player2_id = :uid) '
        'AND winner_id IS NOT NULL',
        {'uid': str(user_id)},
    )
    by_dc: Dict[str, Dict[str, int]] = {}
    for row in rows:
        is_p1 = row.get('player1_id') == str(user_id)
        my_army = row.get('player1_army_json' if is_p1 else 'player2_army_json') or {}
        won = row.get('winner_id') == str(user_id)
        if not isinstance(my_army, dict):
            continue
        for dc in my_army.get('dcList') or []:
            if isinstance(dc, str):
                name = dc
            elif isinstance(dc, dict):
                name = dc.get('displayName') or dc.get('name') or ''
            else:
                name = ''
            if not name:
                continue
            by_dc.setdefault(name, {'wins': 0, 'games': 0})
            by_dc[name]['games'] += 1
            if won:
                by_dc[name]['wins'] += 1
    out = [
        {
            'dcName': name,
            'wins': v['wins'], 'games': v['games'],
            'winRate': round(100.0 * v['wins'] / v['games'], 1) if v['games'] else 0,
        }
        for name, v in by_dc.items()
    ]
    out.sort(key=lambda x: x['games'], reverse=True)
    return out[:limit]


def get_earned_achievements(store: Any, user_id: str) -> List[Dict[str, Any]]:
    sql = """
    SELECT a.id, a.name, a.description, a.icon, ua.earned_at
    FROM user_achievements ua
    JOIN achievement_defs a ON a.id = ua.achievement_id
    WHERE ua.user_id = :uid
    ORDER BY ua.earned_at DESC
    """
    rows = _query(store, sql, {'uid': str(user_id)})
    return [
        {
            'id': r.get('id'),
            'name': r.get('name'),
            'description': r.get('description'),
            'icon': r.get('icon') or '🏆',
            'earnedAt': r.get('earned_at'),
        }
        for r in rows
    ]
