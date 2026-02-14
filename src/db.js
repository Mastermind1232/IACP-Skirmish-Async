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
