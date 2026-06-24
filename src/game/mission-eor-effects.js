/**
 * Mission EoR effects registry (alexanbv 2026-05-10).
 *
 * Each registered effect is an async handler that runs during the
 * mission-EoR phase (BEFORE either player's DC EoR) when the active
 * mission's rules.endOfRound declares the matching flag.
 *
 * Effect handler contract:
 *   async function effectHandler(game, ctx, opts) => result
 *     game  — full game state object
 *     ctx   — round-handler ctx (logGameAction, client, saveGames,
 *             dcMessageMeta, dcHealthState, getMapTokensData, etc.)
 *     opts  — { gameId, interaction (nullable), logVars }
 *     result — { pending: boolean }
 *
 * Returning `{ pending: true }` means the effect posted a player picker
 * and the round-end chain must halt. The picker's drain handler is
 * responsible for resuming via runRemainingMissionEorEffects + then
 * calling _runDcEorAndContinue with the captured logVars.
 *
 * Iteration order: registered effects are dispatched in the order they
 * appear in `EFFECT_ORDER` (deterministic so missions that combine
 * multiple async effects get a stable sequence).
 *
 * Design notes:
 *  - Effects that don't pause execution (purely synchronous mutations
 *    + log lines) belong in src/game/mission-rules.js#runEndOfRoundRules
 *    — that helper runs synchronously and is called from
 *    handleEndEndOfRound's mission EoR hoist before this registry.
 *  - This registry only owns async player-picker effects.
 */

const _registry = new Map();
const _sorRegistry = new Map();

/**
 * Register an async effect handler under a rule flag name.
 * @param {string} flagName  e.g. 'npcThugs', 'npcKryknaActivation'
 * @param {Function} handler async (game, ctx, opts) => { pending: boolean }
 */
export function registerMissionEorEffect(flagName, handler) {
  if (typeof flagName !== 'string' || typeof handler !== 'function') return;
  _registry.set(flagName, handler);
}

/**
 * Canonical iteration order for mission EoR effects. Add new effects
 * here when registering them so the dispatch order is stable. Effects
 * not in this list run after, in registration order.
 */
const EFFECT_ORDER = [
  'npcThugs',
  'npcKryknaActivation',
  'openDoorPerTerminal',
  'fluctuationSwapGate',
];

/**
 * Run every registered mission EoR effect for the active mission's rules.
 * Stops on the first effect that returns `{ pending: true }`. Stores the
 * remaining effect names on game._pendingMissionEorEffects so the picker
 * drain can resume via runRemainingMissionEorEffects.
 *
 * Returns `{ pending: true }` if any effect halted, else `{ pending: false }`.
 */
export async function runMissionEorEffects(game, missionEndOfRoundRules, ctx, opts) {
  if (!missionEndOfRoundRules || typeof missionEndOfRoundRules !== 'object') {
    return { pending: false };
  }
  const flagsToRun = _orderedFlags(missionEndOfRoundRules);
  for (let i = 0; i < flagsToRun.length; i++) {
    const flag = flagsToRun[i];
    const handler = _registry.get(flag);
    if (!handler) continue;
    const res = await handler(game, ctx, opts);
    if (res?.pending) {
      // Stash the remaining queue so the picker drain can resume from
      // the NEXT flag onward, plus the captured logVars for the final
      // _runDcEorAndContinue call.
      game._pendingMissionEorEffects = flagsToRun.slice(i + 1);
      game._pendingMissionEorLogVars = opts?.logVars || null;
      return { pending: true };
    }
  }
  return { pending: false };
}

/**
 * Resume iteration of mission EoR effects from where a picker halted.
 * Picker drain handlers call this after their async work completes;
 * if no more effects remain pending, they then call _runDcEorAndContinue
 * (which the caller imports separately).
 *
 * Returns `{ pending: true }` if a subsequent effect is now waiting on
 * a player; `{ pending: false }` if the queue is fully drained.
 */
export async function runRemainingMissionEorEffects(game, ctx) {
  const remaining = game._pendingMissionEorEffects || [];
  if (remaining.length === 0) {
    delete game._pendingMissionEorEffects;
    return { pending: false };
  }
  for (let i = 0; i < remaining.length; i++) {
    const flag = remaining[i];
    const handler = _registry.get(flag);
    if (!handler) continue;
    const res = await handler(game, ctx, { logVars: game._pendingMissionEorLogVars });
    if (res?.pending) {
      game._pendingMissionEorEffects = remaining.slice(i + 1);
      return { pending: true };
    }
  }
  delete game._pendingMissionEorEffects;
  return { pending: false };
}

/**
 * Read the captured logVars from when the mission EoR phase first halted.
 * Used by the final picker-drain in a chain to forward into
 * _runDcEorAndContinue. Optionally clears them.
 */
export function getMissionEorLogVars(game, { clear = false } = {}) {
  const v = game._pendingMissionEorLogVars || null;
  if (clear) delete game._pendingMissionEorLogVars;
  return v;
}

function _orderedFlags(rulesEndOfRound) {
  const presentFlags = Object.keys(rulesEndOfRound).filter((k) => rulesEndOfRound[k] !== undefined && rulesEndOfRound[k] !== false);
  const seen = new Set();
  const out = [];
  for (const f of EFFECT_ORDER) {
    if (presentFlags.includes(f) && _registry.has(f)) {
      out.push(f);
      seen.add(f);
    }
  }
  for (const f of presentFlags) {
    if (!seen.has(f) && _registry.has(f)) out.push(f);
  }
  return out;
}

// ── Start-of-round (SOR) registry ─────────────────────────────────────────────
//
// Mission SOR effects fire BEFORE either player's DC SOR (CRR ordering).
// API mirrors the EoR registry but reads from rules.startOfRound and
// stores resume state under _pendingMissionSorEffects / _pendingMissionSorLogVars.
//
// A registered SOR handler may be async and may return { pending: true }
// to halt round-start until a player resolves an interactive prompt
// (e.g. Chopper Base Atollon B "Powered Perimeter" random token reveal).
// Its drain handler resumes via runRemainingMissionSorEffects.

const SOR_EFFECT_ORDER = [
  'randomRevealAndPlaceStrain', // Chopper Base Atollon B Powered Perimeter
];

export function registerMissionSorEffect(flagName, handler) {
  if (typeof flagName !== 'string' || typeof handler !== 'function') return;
  _sorRegistry.set(flagName, handler);
}

export async function runMissionSorEffects(game, missionStartOfRoundRules, ctx, opts) {
  if (!missionStartOfRoundRules || typeof missionStartOfRoundRules !== 'object') {
    return { pending: false };
  }
  const flagsToRun = _orderedSorFlags(missionStartOfRoundRules);
  for (let i = 0; i < flagsToRun.length; i++) {
    const flag = flagsToRun[i];
    const handler = _sorRegistry.get(flag);
    if (!handler) continue;
    const res = await handler(game, ctx, opts);
    if (res?.pending) {
      game._pendingMissionSorEffects = flagsToRun.slice(i + 1);
      game._pendingMissionSorLogVars = opts?.logVars || null;
      return { pending: true };
    }
  }
  return { pending: false };
}

export async function runRemainingMissionSorEffects(game, ctx) {
  const remaining = game._pendingMissionSorEffects || [];
  if (remaining.length === 0) {
    delete game._pendingMissionSorEffects;
    return { pending: false };
  }
  for (let i = 0; i < remaining.length; i++) {
    const flag = remaining[i];
    const handler = _sorRegistry.get(flag);
    if (!handler) continue;
    const res = await handler(game, ctx, { logVars: game._pendingMissionSorLogVars });
    if (res?.pending) {
      game._pendingMissionSorEffects = remaining.slice(i + 1);
      return { pending: true };
    }
  }
  delete game._pendingMissionSorEffects;
  return { pending: false };
}

function _orderedSorFlags(rulesStartOfRound) {
  const presentFlags = Object.keys(rulesStartOfRound).filter((k) => rulesStartOfRound[k] !== undefined && rulesStartOfRound[k] !== false);
  const seen = new Set();
  const out = [];
  for (const f of SOR_EFFECT_ORDER) {
    if (presentFlags.includes(f) && _sorRegistry.has(f)) {
      out.push(f);
      seen.add(f);
    }
  }
  for (const f of presentFlags) {
    if (!seen.has(f) && _sorRegistry.has(f)) out.push(f);
  }
  return out;
}
