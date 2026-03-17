/**
 * Game state ownership: games Map and DC-related Maps.
 * Handlers use getGame/setGame and persist via saveGames().
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isDbConfigured, initDb, loadGamesFromDb, saveGamesToDb, savePromise, getActiveGameIdsFromEvents, markGameDirty } from './db.js';
import { initSeqCounters, replayToState } from './domain/event-store.js';
import { getDcList, getDcMessageIds, getActivatedDcIndices } from './game/player-helpers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const GAMES_STATE_PATH = join(rootDir, 'data', 'games-state.json');

/** Current game state schema version (DB4). Bump when adding migrations. */
export const CURRENT_GAME_VERSION = 2;

/** When true, state blob AND domain events are persisted. When false, only events. */
export const DUAL_WRITE_MODE = true;

/**
 * Event-source read mode (env EVENT_SOURCE_READ).
 * - 'off' (default): load state from blob DB (current behavior)
 * - 'shadow': load from blob, then replay events and log mismatches (safe validation)
 * - 'primary': load state from event replay, blob as fallback only
 * - 'exclusive': load state from event replay only, no blob fallback
 */
const EVENT_SOURCE_READ = process.env.EVENT_SOURCE_READ || 'off';

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

/** Compute phase from legacy flags for v1→v2 migration. */
function computePhaseFromFlags(g) {
  if (g.phase) return; // already set — idempotent
  if (g.ended) {
    g.phase = 'ended';
    g.roundPhase = null;
    return;
  }
  if (g.currentRound && g.player1CcDrawn && g.player2CcDrawn) {
    g.phase = 'round_active';
    if (g.endOfRoundWhoseTurn) {
      g.roundPhase = 'end_of_round';
    } else if ((g.pendingStartOfRoundResolve || 0) > 0) {
      g.roundPhase = 'start_of_round';
    } else {
      g.roundPhase = 'activation';
    }
    return;
  }
  if (g.initiativePlayerDeployed && g.nonInitiativePlayerDeployed) {
    if (g.setupAttachmentPhase) {
      g.phase = 'attachment';
    } else {
      g.phase = 'cc_draw';
    }
    g.roundPhase = null;
    return;
  }
  if (g.deploymentZoneChosen) {
    g.phase = 'deployment';
    g.roundPhase = null;
    return;
  }
  if (g.initiativeDetermined) {
    g.phase = 'zone_selection';
    g.roundPhase = null;
    return;
  }
  if (g.mapSelected) {
    g.phase = 'initiative';
    g.roundPhase = null;
    return;
  }
  if (g.generalId) {
    g.phase = 'map_selection';
    g.roundPhase = null;
    return;
  }
  g.phase = 'lobby';
  g.roundPhase = null;
}

/** Run migrations on a loaded game so old saves keep working (DB4). */
function migrateGame(g) {
  if (!g || typeof g !== 'object') return;
  const v = g.version ?? 0;
  if (v < 1) {
    g.version = 1;
  }
  if (v < 2) {
    computePhaseFromFlags(g);
    g.version = 2;
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

  ensureGameShape(g);
}

/**
 * Ensure commonly-used game state container properties exist with correct defaults.
 * Only initializes properties that are always-present containers (never used as
 * state flags via truthiness checks). Pending/active/inProgress properties are
 * excluded since code checks `if (game.X)` to detect whether that state is active.
 */
function ensureGameShape(game) {
  // Properties that should always be {} (keyed containers)
  const OBJ = [
    // Figure state (always keyed by playerNum or figureKey)
    'figurePositions', 'figureConditions', 'figureStrain', 'figureConfig',
    'figureOrientations', 'figureNicknames', 'figurePowerTokens', 'figureContraband',
    // Movement containers (keyed by msgId)
    'movementBank', 'moveGridMessageIds',
    // DC state (keyed by msgId)
    'dcActionsData', 'dcActivationLogMessageIds', 'dcFinishedPinged',
    'deploySpaceGridMessageIds', 'lastActivationMsgIdByPlayer',
    // Setup (keyed by playerNum)
    'setupAttachmentPending', 'setupAttachmentApplied', 'setupAttachmentConfirmed',
    // CC/DC attachments (keyed by msgId)
    'p1CcAttachments', 'p2CcAttachments', 'p1DcAttachments', 'p2DcAttachments',
    // Activation tracking (keyed by msgId or figureKey, reset each activation)
    'activationStartPositions', 'activationDamagedFigures', 'activationKills',
    'activationDoubleSpecialAction', 'activationExtraActionThenStun',
    'attackPerformedThisActivation',
    // Round-scoped containers (keyed by msgId/figureKey, reset each round)
    'roundFigureAbilityUsed', 'roundAttackRerollDice', 'roundAttackSurgeBonus',
    'roundDefenseBonusBlock', 'roundDefenseBonusEvade', 'roundDefenderBonusBlockPerEvade',
    'roundEfficientTravel', 'roundProgrammingOverrideTrait',
    'roundTrooperAttackHitBonus', 'roundVehicleSpeedBonus',
    // Combat targeting (keyed by msgId)
    'attackTargets', 'falseOrdersAttackTargets', 'falseOrdersUpgrade',
    'nextAttackBonusSurgeAbilities', 'nextAttackBonusAccuracy', 'nextAttackBonusPierce',
    'nextAttackReach', 'nextAttacksBonusConditions', 'nextAttacksBonusHits',
    'nextAttackIgnoreFigureLOS', 'nextActivationFreeAttack', 'nextHostileDefeatVpBonus',
    // Post-combat / end-of-round containers
    'postActivationConditions', 'endOfRoundSelfDamage',
    // Map tokens (keyed by coord or id)
    'cratePositions', 'crateHealth', 'crateTokens', 'deviceTokens',
    'ancillaryTokens', 'orbitalBombardmentTokens',
    // Misc keyed containers
    'exhaustedSkirmishUpgrades', 'defenderThreadData', 'priceBounties',
    'paybackBonusSurge', 'optimalBombardmentBlastBonus',
    'lastResortTriggered', 'partingShotTriggered', 'selfDestructProtocolTriggered',
    'recoverOnHostileDefeat', 'etiquetteBlockPairs',
  ];
  for (const k of OBJ) {
    if (game[k] == null) game[k] = {};
  }

  // Tiebreaker tracking: total damage received per player
  if (!game.totalDamageReceived || typeof game.totalDamageReceived !== 'object') {
    game.totalDamageReceived = { 1: 0, 2: 0 };
  }

  // Properties that should always be [] (arrays)
  const ARR = [
    'undoStack', 'openedDoors', 'rubbleTokens',
    'crippledFigures', 'disabledFigures',
    'p1ActivatedDcIndices', 'p2ActivatedDcIndices',
    'p1DepletedDcMessageIds', 'p2DepletedDcMessageIds',
    'initiativeDeployMessageIds', 'nonInitiativeDeployMessageIds',
    'nonInitiativeDeployedConfirmIds', 'attachRedoNoticeIds',
    'setupLogMessageIds',
  ];
  for (const k of ARR) {
    if (!Array.isArray(game[k])) game[k] = [];
  }
}

/** messageId -> { gameId, playerNum, dcName, displayName } */
const dcMessageMeta = new Map();
/** messageId -> boolean (exhausted) */
const dcExhaustedState = new Map();
/** messageId -> healthState array */
const dcHealthState = new Map();
/** key = `${gameId}_${playerNum}`, value = { squad, timestamp } */
const pendingIllegalSquad = new Map();
/** key = `${gameId}_${playerNum}`, value = { squad, validation, timestamp } */
const pendingSquadConfirm = new Map();

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

/** Set game and persist in one call. Convenience wrapper to DRY up setGame+saveGames. */
export function persistGame(gameId, game) {
  games.set(gameId, game);
  saveGames(gameId);
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
    if (idx >= 0 && dcList[idx] && Array.isArray(healthState)) {
      dcList[idx].healthState = [...healthState];
    }
  }
}

/** Persist games to DB or file. Pass gameId to save only that game; omit to save all. */
export async function saveGames(gameId) {
  if (!gamesLoadedOk) {
    console.warn('[Games] saveGames() called before load completed — skipping to protect DB.');
    return;
  }
  // In exclusive event-source mode, skip blob writes entirely
  if (EVENT_SOURCE_READ === 'exclusive') {
    return;
  }
  syncHealthStateToGames();
  if (isDbConfigured()) {
    if (gameId) {
      markGameDirty(gameId);
    } else {
      // No specific game — mark all as dirty (backward compat)
      for (const id of games.keys()) markGameDirty(id);
    }
    try {
      await saveGamesToDb(games);
    } catch (err) {
      console.error('[Games] saveGamesToDb promise rejected:', err);
    }
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

      if (EVENT_SOURCE_READ === 'exclusive') {
        // Load entirely from event replay — no blob
        await _loadFromEventReplay();
      } else if (EVENT_SOURCE_READ === 'primary') {
        // Try event replay first, fall back to blob
        const replayOk = await _loadFromEventReplay();
        if (!replayOk) {
          console.warn('[Games] Event replay failed, falling back to blob.');
          await _loadFromBlob();
        }
      } else {
        // 'off' or 'shadow': load from blob (default)
        await _loadFromBlob();

        if (EVENT_SOURCE_READ === 'shadow') {
          // Shadow mode: replay events and compare with blob, log mismatches
          await _shadowValidateAll();
        }
      }

      gamesLoadedOk = true;
      console.log(`[Games] Loaded ${games.size} game(s) from PostgreSQL (mode: ${EVENT_SOURCE_READ}).`);

      // Initialize domain event seq counters from DB
      try {
        await initSeqCounters([...games.keys()]);
      } catch (seqErr) {
        console.warn('[Games] Seq counter init failed (non-fatal):', seqErr.message);
      }
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

/** Load games from the state blob in DB. */
async function _loadFromBlob() {
  const data = await loadGamesFromDb();
  for (const [id, g] of Object.entries(data)) {
    if (g && typeof g === 'object') {
      delete g.pendingAttack;
      migrateGame(g);
    }
    games.set(id, g);
  }
}

/** Load games by replaying domain events. Returns true on success. */
async function _loadFromEventReplay() {
  try {
    const gameIds = await getActiveGameIdsFromEvents();
    if (gameIds.length === 0) {
      console.warn('[Games] No games found in domain_events table.');
      return false;
    }
    let loaded = 0;
    let failed = 0;
    for (const gameId of gameIds) {
      try {
        const state = await replayToState(gameId);
        if (state && Object.keys(state).length > 0) {
          games.set(gameId, state);
          loaded++;
        }
      } catch (e) {
        console.error(`[Games] Event replay failed for ${gameId}:`, e.message);
        failed++;
      }
    }
    console.log(`[Games] Event replay: ${loaded} loaded, ${failed} failed out of ${gameIds.length} games.`);
    return failed === 0;
  } catch (e) {
    console.error('[Games] Event replay failed:', e.message);
    return false;
  }
}

/** Shadow validation: replay events for each loaded game, log mismatches. */
async function _shadowValidateAll() {
  try {
    const { shadowCompare } = await import('./domain/event-verifier.js');
    let checked = 0;
    let mismatched = 0;
    for (const [gameId, blobState] of games) {
      try {
        const result = await shadowCompare(gameId, blobState);
        checked++;
        if (!result.match) {
          mismatched++;
          console.warn(`[shadow] Game ${gameId}: ${result.mismatches.join(', ')} (${result.eventCount} events)`);
        }
      } catch (e) {
        console.warn(`[shadow] Game ${gameId} check failed:`, e.message);
      }
    }
    console.log(`[shadow] Startup validation: ${checked} checked, ${mismatched} mismatches.`);
  } catch (e) {
    console.warn('[shadow] Validation failed:', e.message);
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

/**
 * Rebuild dcMessageMeta, dcExhaustedState, dcHealthState for a single game.
 * Call after restoring a game snapshot to keep side-channel Maps consistent.
 */
export function repopulateDcMapsForGame(gameId) {
  // Clear existing entries for this game
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId === gameId) {
      dcMessageMeta.delete(msgId);
      dcExhaustedState.delete(msgId);
      dcHealthState.delete(msgId);
    }
  }
  // Rebuild from current game state
  const game = games.get(gameId);
  if (!game) return;
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

/** Remove all dcMessageMeta/dcExhaustedState/dcHealthState entries for a game. Prevents memory leaks on game end. */
export function cleanupGameMaps(gameId) {
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId === gameId) {
      dcMessageMeta.delete(msgId);
      dcExhaustedState.delete(msgId);
      dcHealthState.delete(msgId);
    }
  }
}

export {
  dcMessageMeta,
  dcExhaustedState,
  dcHealthState,
  pendingIllegalSquad,
  pendingSquadConfirm,
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
