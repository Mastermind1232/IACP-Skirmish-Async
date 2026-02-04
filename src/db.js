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

/** Connect and create the games table if it doesn't exist. */
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
    console.log('[DB] PostgreSQL connected, games table ready.');
  } catch (err) {
    console.error('[DB] Failed to connect:', err.message);
    pool = null;
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

/** Save all games to the database. Serializes the games Map. */
let savePromise = Promise.resolve();

export async function saveGamesToDb(gamesMap) {
  if (!pool) return;
  const data = Object.fromEntries(gamesMap);
  savePromise = savePromise.then(async () => {
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM games');
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
