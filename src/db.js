/**
 * PostgreSQL persistence for game state.
 * Used when DATABASE_URL is set (e.g. on Railway).
 * Falls back to file-based storage when not set (local dev).
 */
import pg from 'pg';

const { Pool } = pg;

let pool = null;

/** True if DATABASE_URL is set and we should use Postgres. */
export function isDbConfigured() {
  return !!process.env.DATABASE_URL;
}

/** Connect and create the games and completed_games tables if they don't exist (DB2). */
export async function initDb() {
  if (!isDbConfigured()) return;
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        game_id TEXT PRIMARY KEY,
        game_data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS completed_games (
        id SERIAL PRIMARY KEY,
        winner_id TEXT,
        player1_id TEXT NOT NULL,
        player2_id TEXT NOT NULL,
        player1_affiliation TEXT,
        player2_affiliation TEXT,
        player1_army_json JSONB,
        player2_army_json JSONB,
        map_id TEXT,
        mission_id TEXT,
        deployment_zone_winner TEXT,
        ended_at TIMESTAMPTZ DEFAULT NOW(),
        round_count INT
      )
    `);
    // DB3: optional indexes for active games / recent updates
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games (updated_at)').catch((err) => { console.error('[discord]', err?.message ?? err); });
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_games_ended ON games ((game_data->>'ended'))`).catch((err) => { console.error('[discord]', err?.message ?? err); });
    // Achievements tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS achievement_defs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT DEFAULT '🏆',
        trigger TEXT NOT NULL,
        threshold INT NOT NULL DEFAULT 1
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_achievements (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL REFERENCES achievement_defs(id),
        earned_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, achievement_id)
      )
    `);
    await seedAchievements();
    console.log('[DB] PostgreSQL connected, games and completed_games tables ready.');
  } catch (err) {
    console.error('[DB] Failed to connect:', err.message);
    pool = null;
  }
}

/** Write a row to completed_games when a game ends (DB2). Call in the same path that sets game.ended. */
export async function insertCompletedGame(game) {
  if (!pool || !game?.ended) return;
  try {
    const winnerId = game.winnerId ?? null;
    const player1Id = game.player1Id ?? '';
    const player2Id = game.player2Id ?? '';
    const p1Squad = game.player1Squad || {};
    const p2Squad = game.player2Squad || {};
    const mapId = game.selectedMap?.id ?? null;
    const missionId = game.selectedMission ? `${game.selectedMap?.id || ''}:${game.selectedMission.variant || 'a'}` : null;
    const deploymentZoneWinner = game.deploymentZoneChosen ? (game.initiativePlayerId === game.player1Id ? game.player1Id : game.player2Id) : null;
    const roundCount = game.currentRound ?? null;
    await pool.query(
      `INSERT INTO completed_games (winner_id, player1_id, player2_id, player1_affiliation, player2_affiliation, player1_army_json, player2_army_json, map_id, mission_id, deployment_zone_winner, round_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [winnerId, player1Id, player2Id, p1Squad.affiliation ?? null, p2Squad.affiliation ?? null, JSON.stringify(p1Squad), JSON.stringify(p2Squad), mapId, missionId, deploymentZoneWinner, roundCount]
    );
  } catch (err) {
    console.error('[DB] insertCompletedGame failed:', err.message);
  }
}

/** Load all games from the database. Returns { gameId: gameObject, ... }. */
export async function loadGamesFromDb() {
  if (!pool) return {};
  try {
    const res = await pool.query('SELECT game_id, game_data FROM games');
    const out = {};
    for (const row of res.rows) {
      const g = row.game_data;
      if (g && typeof g === 'object') delete g.pendingAttack;
      out[row.game_id] = g;
    }
    return out;
  } catch (err) {
    console.error('[DB] Load failed:', err.message);
    return {};
  }
}

/** Save all games to the database. Serializes the games Map. DB5: only delete rows for games no longer in the in-memory map; upsert the rest. */
let savePromise = Promise.resolve();

export async function saveGamesToDb(gamesMap) {
  if (!pool) return;
  const data = Object.fromEntries(gamesMap);
  const currentIds = Object.keys(data);
  savePromise = savePromise.then(async () => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (currentIds.length === 0) {
          await client.query('DELETE FROM games');
        } else {
          await client.query('DELETE FROM games WHERE NOT (game_id = ANY($1::text[]))', [currentIds]);
        }
        for (const [gameId, game] of Object.entries(data)) {
          await client.query(
            `INSERT INTO games (game_id, game_data) VALUES ($1, $2)
             ON CONFLICT (game_id) DO UPDATE SET game_data = $2, updated_at = NOW()`,
            [gameId, JSON.stringify(game)]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[DB] Save failed:', err.message);
    }
  });
  return savePromise;
}

/** Remove a game from the database (when game is killed). */
export async function deleteGameFromDb(gameId) {
  if (!pool) return;
  try {
    await pool.query('DELETE FROM games WHERE game_id = $1', [gameId]);
  } catch (err) {
    console.error('[DB] Delete failed:', err.message);
  }
}

// --- Stats (completed_games); for use in #statistics channel commands ---

/** Return { totalGames, draws } from completed_games. */
export async function getStatsSummary() {
  if (!pool) return { totalGames: 0, draws: 0 };
  try {
    const count = await pool.query('SELECT COUNT(*)::int AS n FROM completed_games');
    const draws = await pool.query("SELECT COUNT(*)::int AS n FROM completed_games WHERE winner_id IS NULL");
    return { totalGames: count.rows[0]?.n ?? 0, draws: draws.rows[0]?.n ?? 0 };
  } catch (err) {
    console.error('[DB] getStatsSummary failed:', err.message);
    return { totalGames: 0, draws: 0 };
  }
}

/** Win rate by affiliation. Returns [{ affiliation, wins, games, winRate }] sorted by games desc. */
export async function getAffiliationWinRates() {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        SUM(wins)::int AS wins,
        SUM(games)::int AS games,
        ROUND(100.0 * SUM(wins) / NULLIF(SUM(games), 0), 1) AS win_rate
      FROM (
        SELECT player1_affiliation AS aff, (winner_id = player1_id)::int AS wins, 1 AS games FROM completed_games WHERE winner_id IS NOT NULL AND player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff, (winner_id = player2_id)::int AS wins, 1 AS games FROM completed_games WHERE winner_id IS NOT NULL AND player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff
      ORDER BY SUM(games) DESC
    `);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      wins: Number(r.wins),
      games: Number(r.games),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationWinRates failed:', err.message);
    return [];
  }
}

/** Win rate by deployment card (from army JSON dcList). Returns top N entries [{ dcName, wins, games, winRate }] by games desc. */
export async function getDcWinRates(limit = 20) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      'SELECT player1_army_json, player2_army_json, winner_id, player1_id, player2_id FROM completed_games WHERE winner_id IS NOT NULL'
    );
    const byDc = {};
    for (const row of res.rows) {
      const p1Won = row.winner_id === row.player1_id;
      const p2Won = row.winner_id === row.player2_id;
      const dcList1 = (row.player1_army_json && row.player1_army_json.dcList) || [];
      const dcList2 = (row.player2_army_json && row.player2_army_json.dcList) || [];
      const names1 = dcList1.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      const names2 = dcList2.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      for (const name of names1) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (p1Won) byDc[name].wins += 1;
      }
      for (const name of names2) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (p2Won) byDc[name].wins += 1;
      }
    }
    return Object.entries(byDc)
      .map(([dcName, o]) => ({
        dcName,
        wins: o.wins,
        games: o.games,
        winRate: o.games ? Math.round((100.0 * o.wins) / o.games * 10) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, limit);
  } catch (err) {
    console.error('[DB] getDcWinRates failed:', err.message);
    return [];
  }
}

/** Stats summary for a single player: { games, wins, losses, draws, winRate }. */
export async function getStatsSummaryForPlayer(userId) {
  if (!pool) return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
  try {
    const res = await pool.query(`
      SELECT
        COUNT(*)::int AS games,
        SUM(CASE WHEN winner_id = $1 THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN winner_id IS NOT NULL AND winner_id <> $1 THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN winner_id IS NULL THEN 1 ELSE 0 END)::int AS draws
      FROM completed_games
      WHERE player1_id = $1 OR player2_id = $1
    `, [userId]);
    const r = res.rows[0] ?? { games: 0, wins: 0, losses: 0, draws: 0 };
    const games = Number(r.games ?? 0);
    const wins = Number(r.wins ?? 0);
    const decisiveGames = games - Number(r.draws ?? 0);
    const winRate = decisiveGames > 0 ? Math.round((100.0 * wins) / decisiveGames * 10) / 10 : 0;
    return { games, wins, losses: Number(r.losses ?? 0), draws: Number(r.draws ?? 0), winRate };
  } catch (err) {
    console.error('[DB] getStatsSummaryForPlayer failed:', err.message);
    return { games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
  }
}

/** Win rate by affiliation for a single player. Returns [{ affiliation, wins, games, winRate }]. */
export async function getAffiliationWinRatesPersonal(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        SUM(wins)::int AS wins,
        SUM(games)::int AS games,
        ROUND(100.0 * SUM(wins) / NULLIF(SUM(games), 0), 1) AS win_rate
      FROM (
        SELECT player1_affiliation AS aff, (winner_id = player1_id)::int AS wins, 1 AS games
          FROM completed_games WHERE winner_id IS NOT NULL AND player1_affiliation IS NOT NULL AND player1_id = $1
        UNION ALL
        SELECT player2_affiliation AS aff, (winner_id = player2_id)::int AS wins, 1 AS games
          FROM completed_games WHERE winner_id IS NOT NULL AND player2_affiliation IS NOT NULL AND player2_id = $1
      ) t
      GROUP BY aff ORDER BY SUM(games) DESC
    `, [userId]);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      wins: Number(r.wins),
      games: Number(r.games),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationWinRatesPersonal failed:', err.message);
    return [];
  }
}

/** Pick rate by affiliation (global). Returns [{ affiliation, picks, totalArmies, pickRate }]. */
export async function getAffiliationPickRates() {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        COUNT(*)::int AS picks,
        (SELECT COUNT(*) * 2 FROM completed_games WHERE player1_affiliation IS NOT NULL)::int AS total_armies,
        ROUND(100.0 * COUNT(*) / NULLIF((SELECT COUNT(*) * 2 FROM completed_games WHERE player1_affiliation IS NOT NULL), 0), 1) AS pick_rate
      FROM (
        SELECT player1_affiliation AS aff FROM completed_games WHERE player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff FROM completed_games WHERE player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff ORDER BY COUNT(*) DESC
    `);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      picks: Number(r.picks),
      totalArmies: Number(r.total_armies),
      pickRate: r.pick_rate != null ? Number(r.pick_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationPickRates failed:', err.message);
    return [];
  }
}

/** Pick rate by affiliation for a single player. Returns [{ affiliation, picks, totalArmies, pickRate }]. */
export async function getAffiliationPickRatesPersonal(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        aff AS affiliation,
        COUNT(*)::int AS picks,
        (
          SELECT COUNT(*) FROM (
            SELECT player1_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player1_affiliation IS NOT NULL
            UNION ALL
            SELECT player2_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player2_affiliation IS NOT NULL
          ) sub
        )::int AS total_armies,
        ROUND(100.0 * COUNT(*) / NULLIF(
          (
            SELECT COUNT(*) FROM (
              SELECT player1_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player1_affiliation IS NOT NULL
              UNION ALL
              SELECT player2_affiliation FROM completed_games WHERE (player1_id = $1 OR player2_id = $1) AND player2_affiliation IS NOT NULL
            ) sub2
          ), 0
        ), 1) AS pick_rate
      FROM (
        SELECT player1_affiliation AS aff FROM completed_games WHERE player1_id = $1 AND player1_affiliation IS NOT NULL
        UNION ALL
        SELECT player2_affiliation AS aff FROM completed_games WHERE player2_id = $1 AND player2_affiliation IS NOT NULL
      ) t
      GROUP BY aff ORDER BY COUNT(*) DESC
    `, [userId]);
    return res.rows.map((r) => ({
      affiliation: r.affiliation,
      picks: Number(r.picks),
      totalArmies: Number(r.total_armies),
      pickRate: r.pick_rate != null ? Number(r.pick_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getAffiliationPickRatesPersonal failed:', err.message);
    return [];
  }
}

/** Win rate by DC for a single player. Returns top N [{ dcName, wins, games, winRate }] by games desc. */
export async function getDcWinRatesPersonal(userId, limit = 20) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT player1_army_json, player2_army_json, winner_id, player1_id, player2_id
       FROM completed_games WHERE winner_id IS NOT NULL AND (player1_id = $1 OR player2_id = $1)`,
      [userId]
    );
    const byDc = {};
    for (const row of res.rows) {
      const isP1 = row.player1_id === userId;
      const playerWon = row.winner_id === userId;
      const myArmy = isP1 ? row.player1_army_json : row.player2_army_json;
      const dcList = (myArmy && myArmy.dcList) || [];
      const names = dcList.map((d) => (typeof d === 'string' ? d : d?.displayName || d?.name || '')).filter(Boolean);
      for (const name of names) {
        if (!byDc[name]) byDc[name] = { wins: 0, games: 0 };
        byDc[name].games += 1;
        if (playerWon) byDc[name].wins += 1;
      }
    }
    return Object.entries(byDc)
      .map(([dcName, o]) => ({
        dcName,
        wins: o.wins,
        games: o.games,
        winRate: o.games ? Math.round((100.0 * o.wins) / o.games * 10) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games)
      .slice(0, limit);
  } catch (err) {
    console.error('[DB] getDcWinRatesPersonal failed:', err.message);
    return [];
  }
}

/** Leaderboard: top players by win count. Returns [{ playerId, wins, losses, draws, games, winRate }]. */
export async function getLeaderboard(limit = 10) {
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT
        player_id,
        SUM(won)::int AS wins,
        SUM(lost)::int AS losses,
        SUM(draw)::int AS draws,
        COUNT(*)::int AS games,
        ROUND(100.0 * SUM(won) / NULLIF(COUNT(*) - SUM(draw), 0), 1) AS win_rate
      FROM (
        SELECT player1_id AS player_id,
          (winner_id = player1_id)::int AS won,
          (winner_id = player2_id)::int AS lost,
          (winner_id IS NULL)::int AS draw
        FROM completed_games
        UNION ALL
        SELECT player2_id AS player_id,
          (winner_id = player2_id)::int AS won,
          (winner_id = player1_id)::int AS lost,
          (winner_id IS NULL)::int AS draw
        FROM completed_games
      ) t
      GROUP BY player_id
      HAVING COUNT(*) >= 5
      ORDER BY win_rate DESC NULLS LAST, wins DESC
      LIMIT $1
    `, [limit]);
    return res.rows.map((r) => ({
      playerId: r.player_id,
      wins: Number(r.wins ?? 0),
      losses: Number(r.losses ?? 0),
      draws: Number(r.draws ?? 0),
      games: Number(r.games ?? 0),
      winRate: r.win_rate != null ? Number(r.win_rate) : 0,
    }));
  } catch (err) {
    console.error('[DB] getLeaderboard failed:', err.message);
    return [];
  }
}

// ── Achievements ─────────────────────────────────────────────────────────────

const ACHIEVEMENT_SEED = [
  { id: 'complete_1_game',  name: 'First Game',    description: 'Complete your first game',    icon: '🏆', trigger: 'game_complete', threshold: 1  },
  { id: 'complete_5_games', name: 'Regular',       description: 'Complete 5 games',            icon: '🏆', trigger: 'game_complete', threshold: 5  },
  { id: 'complete_10_games',name: 'Veteran',       description: 'Complete 10 games',           icon: '🏆', trigger: 'game_complete', threshold: 10 },
  { id: 'complete_25_games',name: 'Hardened',      description: 'Complete 25 games',           icon: '🏆', trigger: 'game_complete', threshold: 25 },
  { id: 'win_1_game',       name: 'First Victory', description: 'Win your first game',         icon: '🥇', trigger: 'game_win',      threshold: 1  },
  { id: 'win_5_games',      name: 'On a Roll',     description: 'Win 5 games',                 icon: '🥇', trigger: 'game_win',      threshold: 5  },
  { id: 'win_10_games',     name: 'Dominant',      description: 'Win 10 games',                icon: '🥇', trigger: 'game_win',      threshold: 10 },
  { id: 'win_25_games',     name: 'Champion',      description: 'Win 25 games',                icon: '🥇', trigger: 'game_win',      threshold: 25 },
];

async function seedAchievements() {
  if (!pool) return;
  for (const def of ACHIEVEMENT_SEED) {
    await pool.query(
      `INSERT INTO achievement_defs (id, name, description, icon, trigger, threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [def.id, def.name, def.description, def.icon, def.trigger, def.threshold]
    ).catch((err) => console.error('[DB] seedAchievements:', err.message));
  }
}

/** Returns earned achievements for a user: [{id, name, description, icon, earned_at}] */
export async function getEarnedAchievements(userId) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `SELECT d.id, d.name, d.description, d.icon, ua.earned_at
       FROM user_achievements ua
       JOIN achievement_defs d ON d.id = ua.achievement_id
       WHERE ua.user_id = $1
       ORDER BY ua.earned_at ASC`,
      [userId]
    );
    return res.rows;
  } catch (err) {
    console.error('[DB] getEarnedAchievements failed:', err.message);
    return [];
  }
}

/**
 * Check which achievements for `trigger` are newly earned given `statCount`,
 * insert them, and return the newly granted defs.
 * @param {string} userId
 * @param {'game_complete'|'game_win'} trigger
 * @param {number} statCount
 * @returns {Promise<Array<{id, name, description, icon}>>}
 */
export async function checkAndGrantAchievements(userId, trigger, statCount) {
  if (!pool) return [];
  try {
    const res = await pool.query(
      `INSERT INTO user_achievements (user_id, achievement_id)
       SELECT $1, d.id
       FROM achievement_defs d
       WHERE d.trigger = $2 AND d.threshold <= $3
       ON CONFLICT (user_id, achievement_id) DO NOTHING
       RETURNING achievement_id`,
      [userId, trigger, statCount]
    );
    if (res.rows.length === 0) return [];
    const grantedIds = res.rows.map((r) => r.achievement_id);
    const defs = await pool.query(
      `SELECT id, name, description, icon FROM achievement_defs WHERE id = ANY($1)`,
      [grantedIds]
    );
    return defs.rows;
  } catch (err) {
    console.error('[DB] checkAndGrantAchievements failed:', err.message);
    return [];
  }
}
