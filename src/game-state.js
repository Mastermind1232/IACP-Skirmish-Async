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

  // Migrate 'Hit' power tokens to 'Damage' (renamed for IACP correctness)
  if (g.figurePowerTokens) {
    for (const fk of Object.keys(g.figurePowerTokens)) {
      const arr = g.figurePowerTokens[fk];
      if (Array.isArray(arr)) {
        for (let i = 0; i < arr.length; i++) { if (arr[i] === 'Hit') arr[i] = 'Damage'; }
      }
    }
  }

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
    'roundDefenseBonusBlock', 'roundDefenseBonusEvade', 'roundDefenseAccuracyPenalty', 'roundDefenderBonusBlockPerEvade',
    'roundEfficientTravel', 'roundProgrammingOverrideTrait',
    'roundTrooperAttackHitBonus', 'roundVehicleSpeedBonus', 'roundTrooperSurgeStun',
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

/**
 * Side-channel state for DC messages, keyed by Discord message ID.
 *
 * dcMessageMeta is now a DERIVED VIEW (Phase 4 of the renderer plan): it
 * walks `games` on every read instead of holding authoritative storage.
 * Existing readers see the same Map-shaped API; writers (.set/.delete/
 * .clear) silently no-op because game state itself is canonical and
 * already mutated by the caller alongside the Map write.
 *
 * dcExhaustedState and dcHealthState are still real Maps for now —
 * Slices 4b and 4c migrate them in turn.
 */

/**
 * Map-shaped derived view of DC message meta.
 * .get(msgId) walks all games' p1DcMessageIds/p2DcMessageIds, finds
 * the one containing msgId, and returns the meta object derived from
 * the corresponding dcList[i].
 *
 * Writers (.set/.delete/.clear) are intentional no-ops — the underlying
 * game state is canonical. If a caller .set's a value that doesn't
 * appear in any game's dcMessageIds, it silently doesn't exist; the
 * next .get returns undefined. This is correct: such a write was
 * always a logical bug (storing meta for a msgId that game state
 * doesn't acknowledge).
 */
class DerivedDcMessageMeta {
  constructor(gamesMap) { this._games = gamesMap; }

  get(msgId) {
    if (!msgId) return undefined;
    for (const [gameId, game] of this._games) {
      for (const playerNum of [1, 2]) {
        const ids = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const idx = (ids || []).indexOf(msgId);
        if (idx >= 0) {
          const dc = (playerNum === 1 ? game.p1DcList : game.p2DcList)?.[idx];
          if (dc) {
            return {
              gameId,
              playerNum,
              dcName: dc.dcName,
              displayName: dc.displayName || dc.dcName,
            };
          }
        }
      }
    }
    return undefined;
  }

  has(msgId) { return this.get(msgId) !== undefined; }

  set(_msgId, _value) { return this; }       // derived: no-op
  delete(_msgId)      { return false; }     // derived: no-op
  clear()             { /* derived: no-op */ }

  *[Symbol.iterator]() {
    for (const [gameId, game] of this._games) {
      for (const playerNum of [1, 2]) {
        const ids = playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
        const list = playerNum === 1 ? game.p1DcList : game.p2DcList;
        const idsArr = ids || [];
        const listArr = list || [];
        for (let i = 0; i < idsArr.length; i++) {
          const msgId = idsArr[i];
          const dc = listArr[i];
          if (msgId && dc) {
            yield [msgId, {
              gameId,
              playerNum,
              dcName: dc.dcName,
              displayName: dc.displayName || dc.dcName,
            }];
          }
        }
      }
    }
  }

  *keys()    { for (const [k] of this) yield k; }
  *values()  { for (const [, v] of this) yield v; }
  *entries() { yield* this[Symbol.iterator](); }
  forEach(fn) { for (const [k, v] of this) fn(v, k, this); }

  get size() {
    let n = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of this) n++;
    return n;
  }
}

/** Derived view: { gameId, playerNum, dcName, displayName } per msgId */
const dcMessageMeta = new DerivedDcMessageMeta(games);

/**
 * Map-shaped derived view of DC exhausted state.
 * .get(msgId) computes:
 *   activatedDcIndices.has(dcIndex) || abilityExhaustedMsgIds.includes(msgId)
 * which matches what repopulateDcMapsForGame used to compute and store.
 *
 * .set(msgId, value) WRITES THROUGH to canonical state — this closes the
 * documented latent gap where un-exhaust paths set the Map to false but
 * forgot to remove from abilityExhaustedMsgIds. Setting false now also
 * removes from activatedDcIndices for the corresponding dcIndex AND
 * removes msgId from abilityExhaustedMsgIds. Setting true adds to
 * abilityExhaustedMsgIds (round-exhaust via activatedDcIndices is
 * separate; callers that "activate" a DC should use the activation flow,
 * not .set).
 */
class DerivedDcExhaustedState {
  constructor(gamesMap, metaView) {
    this._games = gamesMap;
    this._meta = metaView;
  }

  _resolve(msgId) {
    const meta = this._meta.get(msgId);
    if (!meta) return null;
    const game = this._games.get(meta.gameId);
    if (!game) return null;
    const dcMsgIds = meta.playerNum === 1 ? game.p1DcMessageIds : game.p2DcMessageIds;
    const dcIndex = (dcMsgIds || []).indexOf(msgId);
    if (dcIndex < 0) return null;
    return { game, meta, dcIndex };
  }

  get(msgId) {
    if (!msgId) return undefined;
    const r = this._resolve(msgId);
    if (!r) return undefined;
    const { game, meta, dcIndex } = r;
    const activatedKey = meta.playerNum === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices';
    if ((game[activatedKey] || []).includes(dcIndex)) return true;
    if ((game.abilityExhaustedMsgIds || []).includes(msgId)) return true;
    return false;
  }

  has(msgId) { return this.get(msgId) !== undefined; }

  set(msgId, value) {
    const r = this._resolve(msgId);
    if (!r) return this; // unknown msgId: silently drop (matches DerivedDcMessageMeta semantics)
    const { game, meta, dcIndex } = r;
    if (value) {
      game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds || [];
      if (!game.abilityExhaustedMsgIds.includes(msgId)) {
        game.abilityExhaustedMsgIds.push(msgId);
      }
    } else {
      // Un-exhaust: remove from BOTH abilityExhaustedMsgIds AND activatedDcIndices.
      // This is what the latent-gap call sites failed to do (dc-play-area.js:286
      // un-activate, apply-ability-result.js:61 CC ready, game-tools.js:279 undo).
      if (game.abilityExhaustedMsgIds) {
        game.abilityExhaustedMsgIds = game.abilityExhaustedMsgIds.filter((id) => id !== msgId);
      }
      const activatedKey = meta.playerNum === 1 ? 'p1ActivatedDcIndices' : 'p2ActivatedDcIndices';
      if (game[activatedKey]) {
        game[activatedKey] = game[activatedKey].filter((i) => i !== dcIndex);
      }
    }
    return this;
  }

  delete(_msgId) { return false; }   // no-op: no separate storage
  clear()       { /* no-op */ }

  *[Symbol.iterator]() {
    for (const [msgId] of this._meta) {
      yield [msgId, this.get(msgId)];
    }
  }

  *keys()    { for (const [k] of this) yield k; }
  *values()  { for (const [, v] of this) yield v; }
  *entries() { yield* this[Symbol.iterator](); }
  forEach(fn) { for (const [k, v] of this) fn(v, k, this); }

  get size() {
    let n = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of this) n++;
    return n;
  }
}

/** Derived view: boolean exhausted state per msgId, with write-through .set */
const dcExhaustedState = new DerivedDcExhaustedState(games, dcMessageMeta);
/** messageId -> healthState array — still authoritative; Slice 4c will migrate */
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
  for (const gameId of games.keys()) repopulateDcMapsForGame(gameId);
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
  // Slice 4a + 4b: dcMessageMeta and dcExhaustedState are derived views.
  // Repopulating them would either no-op (meta) or actively corrupt
  // canonical state (dcExhaustedState's write-through .set would push
  // activated-only msgIds into abilityExhaustedMsgIds incorrectly).
  // So those are skipped — the views stay correct because they read
  // game state directly. Only dcHealthState (still a real Map) is
  // rebuilt here. Slice 4c will collapse this further.
  const game = games.get(gameId);
  if (!game) return;
  // Clear existing dcHealthState entries for this game so stale msgIds
  // (from cross-lobby restore where msgIds change) don't linger.
  for (const [msgId, meta] of dcMessageMeta) {
    if (meta?.gameId === gameId) {
      dcHealthState.delete(msgId);
    }
  }
  for (const playerNum of [1, 2]) {
    const dcList = getDcList(game, playerNum) || [];
    const dcMessageIds = getDcMessageIds(game, playerNum) || [];
    for (let i = 0; i < dcMessageIds.length && i < dcList.length; i++) {
      const msgId = dcMessageIds[i];
      const dc = dcList[i];
      if (!msgId || !dc) continue;
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
