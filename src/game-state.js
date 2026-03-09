/**
 * Game state ownership: games Map and DC-related Maps.
 * Handlers use getGame/setGame and persist via saveGames().
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isDbConfigured, initDb, loadGamesFromDb, saveGamesToDb, savePromise } from './db.js';
import { getDcList, getDcMessageIds, getActivatedDcIndices } from './game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const GAMES_STATE_PATH = join(rootDir, 'data', 'games-state.json');

/** Current game state schema version (DB4). Bump when adding migrations. */
export const CURRENT_GAME_VERSION = 1;

/** gameId -> game object */
const games = new Map();

/**
 * Set to true after loadGames() completes successfully.
 * saveGames() bails out early when false, preventing a cold-start
 * empty-map save from wiping the DB.
 */
let gamesLoadedOk = false;

/** Strip faction suffixes like (Mercenary), (Imperial), (Rebel) from CC card names. */
function sanitizeCcNames(arr) {
  if (!Array.isArray(arr)) return;
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] === 'string') {
      arr[i] = arr[i].replace(/\s+\((?:Mercenary|Imperial|Rebel)\)$/i, '').trim();
    }
  }
}

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

  // Strip faction suffixes from stored CC names (e.g. "Opportunistic (Mercenary)" → "Opportunistic")
  sanitizeCcNames(g.player1CcHand);
  sanitizeCcNames(g.player1CcDeck);
  sanitizeCcNames(g.player1CcDiscard);
  sanitizeCcNames(g.player2CcHand);
  sanitizeCcNames(g.player2CcDeck);
  sanitizeCcNames(g.player2CcDiscard);
  if (g.player1Squad?.ccList) sanitizeCcNames(g.player1Squad.ccList);
  if (g.player2Squad?.ccList) sanitizeCcNames(g.player2Squad.ccList);
}

/** messageId -> { gameId, playerNum, dcName, displayName } */
const dcMessageMeta = new Map();
/** messageId -> boolean (exhausted) */
const dcExhaustedState = new Map();
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

/** Sync live dcHealthState Map back into game objects so persisted health is always current. */
function syncHealthStateToGames() {
  for (const [msgId, healthState] of dcHealthState) {
    const meta = dcMessageMeta.get(msgId);
    if (!meta) continue;
    const game = games.get(meta.gameId);
    if (!game || game.ended) continue;
    const dcMessageIds = getDcMessageIds(game, meta.playerNum) || [];
    const dcList = getDcList(game, meta.playerNum) || [];
    const idx = dcMessageIds.indexOf(msgId);
    if (idx >= 0 && dcList[idx]) {
      dcList[idx].healthState = [...healthState];
    }
  }
}

/** Persist all games to DB or file. */
export function saveGames() {
  if (!gamesLoadedOk) {
    console.warn('[Games] saveGames() called before load completed — skipping to protect DB.');
    return;
  }
  syncHealthStateToGames();
  if (isDbConfigured()) {
    saveGamesToDb(games).catch((err) => {
      console.error('[Games] saveGamesToDb promise rejected:', err);
    });
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
      gamesLoadedOk = true;
      console.log(`[Games] Loaded ${games.size} game(s) from PostgreSQL.`);
    } catch (err) {
      console.error('Failed to load games from DB:', err);
    }
    repopulateDcMapsFromGames();
    return;
  }
  try {
    if (!existsSync(GAMES_STATE_PATH)) {
      gamesLoadedOk = true;
      return;
    }
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
    gamesLoadedOk = true;
    repopulateDcMapsFromGames();
  } catch (err) {
    console.error('Failed to load games state:', err);
  }
}

/** Repopulate dcMessageMeta, dcExhaustedState, dcHealthState from loaded games (after loadGames). */
function repopulateDcMapsFromGames() {
  for (const [gameId, game] of games) {
    for (const playerNum of [1, 2]) {
      const dcList = getDcList(game, playerNum) || [];
      const dcMessageIds = getDcMessageIds(game, playerNum) || [];
      const activatedIndices = new Set(getActivatedDcIndices(game, playerNum) || []);
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
  dcHealthState,
  pendingIllegalSquad,
};

/** Graceful shutdown: flush pending DB writes before the process exits. */
async function gracefulShutdown(signal) {
  console.log(`[Games] ${signal} received — flushing pending saves...`);
  try {
    syncHealthStateToGames();
    if (isDbConfigured() && gamesLoadedOk) {
      await saveGamesToDb(games);
      await savePromise;
    }
    console.log('[Games] Save complete. Exiting.');
  } catch (err) {
    console.error('[Games] Shutdown save failed:', err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
