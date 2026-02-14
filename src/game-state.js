/**
 * Game state ownership: games Map and DC-related Maps.
 * Handlers use getGame/setGame and persist via saveGames().
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isDbConfigured, initDb, loadGamesFromDb, saveGamesToDb } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const GAMES_STATE_PATH = join(rootDir, 'data', 'games-state.json');

/** Current game state schema version (DB4). Bump when adding migrations. */
const CURRENT_GAME_VERSION = 1;

/** gameId -> game object */
const games = new Map();

/** Run migrations on a loaded game so old saves keep working (DB4). */
function migrateGame(g) {
  if (!g || typeof g !== 'object') return;
  const v = g.version ?? 0;
  if (v < 1) {
    g.version = 1;
  }
  if (g.version < CURRENT_GAME_VERSION) {
    g.version = CURRENT_GAME_VERSION;
  }
}

/** messageId -> { gameId, playerNum, dcName, displayName } */
const dcMessageMeta = new Map();
/** messageId -> boolean (exhausted) */
const dcExhaustedState = new Map();
/** messageId -> boolean (Skirmish Upgrades with Deplete effect) */
const dcDepletedState = new Map();
/** messageId -> healthState array */
const dcHealthState = new Map();
/** key = `${gameId}_${playerNum}`, value = { squad, timestamp } */
const pendingIllegalSquad = new Map();

/** Get a game by id. */
export function getGame(gameId) {
  return games.get(gameId);
}

/** Set (or replace) a game by id. Does not persist; call saveGames() after. */
export function setGame(gameId, game) {
  games.set(gameId, game);
}

/** Remove a game by id (e.g. when killed). Does not persist; call saveGames() after. */
export function deleteGame(gameId) {
  games.delete(gameId);
}

/** Persist all games to DB or file. */
export function saveGames() {
  if (isDbConfigured()) {
    void saveGamesToDb(games);
    return;
  }
  try {
    const data = Object.fromEntries(games);
    writeFileSync(GAMES_STATE_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save games state:', err);
  }
}

/** Load all games from DB or file; repopulate DC Maps from loaded games. Call at startup. */
export async function loadGames() {
  if (isDbConfigured()) {
    try {
      await initDb();
      const data = await loadGamesFromDb();
      for (const [id, g] of Object.entries(data)) {
        if (g && typeof g === 'object') {
          delete g.pendingAttack;
          migrateGame(g);
        }
        games.set(id, g);
      }
      console.log(`[Games] Loaded ${games.size} game(s) from PostgreSQL.`);
    } catch (err) {
      console.error('Failed to load games from DB:', err);
    }
    repopulateDcMapsFromGames();
    return;
  }
  try {
    if (!existsSync(GAMES_STATE_PATH)) return;
    const raw = readFileSync(GAMES_STATE_PATH, 'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object') {
      for (const [id, g] of Object.entries(data)) {
        if (g && typeof g === 'object') {
          delete g.pendingAttack;
          migrateGame(g);
        }
        games.set(id, g);
      }
    }
    repopulateDcMapsFromGames();
  } catch (err) {
    console.error('Failed to load games state:', err);
  }
}

/** Repopulate dcMessageMeta, dcExhaustedState, dcHealthState from loaded games (after loadGames). */
function repopulateDcMapsFromGames() {
  for (const [gameId, game] of games) {
    for (const playerNum of [1, 2]) {
      const dcList = playerNum === 1 ? (game.p1DcList || []) : (game.p2DcList || []);
      const dcMessageIds = playerNum === 1 ? (game.p1DcMessageIds || []) : (game.p2DcMessageIds || []);
      const activatedIndices = new Set(playerNum === 1 ? (game.p1ActivatedDcIndices || []) : (game.p2ActivatedDcIndices || []));
      for (let i = 0; i < dcMessageIds.length && i < dcList.length; i++) {
        const msgId = dcMessageIds[i];
        const dc = dcList[i];
        if (!msgId || !dc) continue;
        dcMessageMeta.set(msgId, {
          gameId,
          playerNum,
          dcName: dc.dcName,
          displayName: dc.displayName || dc.dcName,
        });
        dcExhaustedState.set(msgId, activatedIndices.has(i));
        dcHealthState.set(msgId, dc.healthState || [[null, null]]);
      }
    }
  }
}

/** For db.js deleteGameFromDb and any code that needs to iterate or pass the Map. */
export function getGamesMap() {
  return games;
}

export {
  dcMessageMeta,
  dcExhaustedState,
  dcDepletedState,
  dcHealthState,
  pendingIllegalSquad,
};
