/**
 * Single-source-of-truth accessors for deployment card state.
 *
 * This module hides the implementation of "given a Discord message ID, what
 * is this DC's exhausted/health/meta?" so call sites stop reaching into the
 * three side-channel Maps directly.
 *
 * Migration-in-progress (see docs / project_dc_state_consolidation_plan.md):
 *   - Slice 1 (this file): accessors exist; implementation reads/writes the
 *     Maps as before. No behavior change. Call sites adopt these helpers in
 *     later slices.
 *   - Slice 5: implementation flips to read/write game.dcList[i] directly.
 *   - Slice 7: the Maps get deleted entirely.
 *
 * The `game` parameter is required on every accessor even though Slice 1
 * doesn't use it — keeps the API stable across the migration so callers
 * don't have to change twice.
 */

import { dcMessageMeta, dcExhaustedState, dcHealthState } from '../game-state.js';

/**
 * Get the meta for a DC message: { gameId, playerNum, dcName, displayName }.
 * Returns null if the msgId is unknown.
 *
 * @param {object} _game - reserved for Slice 5+ (currently unused)
 * @param {string} msgId
 * @returns {{ gameId: string, playerNum: number, dcName: string, displayName: string } | null}
 */
export function getDcInfo(_game, msgId) {
  return dcMessageMeta.get(msgId);
}

/**
 * Get the exhausted state for a DC message. Returns false when unknown
 * (matches the existing convention at every call site).
 *
 * @param {object} _game - reserved for Slice 5+ (currently unused)
 * @param {string} msgId
 * @returns {boolean}
 */
export function getDcExhausted(_game, msgId) {
  return dcExhaustedState.get(msgId);
}

/**
 * Set the exhausted state for a DC message.
 *
 * @param {object} _game - reserved for Slice 2+ (will also write to game.dcList[i])
 * @param {string} msgId
 * @param {boolean} value
 */
export function setDcExhausted(_game, msgId, value) {
  dcExhaustedState.set(msgId, value);
}

/**
 * Get the health state array for a DC message. Returns [[null, null]] when
 * unknown (matches the existing convention).
 *
 * @param {object} _game - reserved for Slice 5+ (currently unused)
 * @param {string} msgId
 * @returns {Array<[number|null, number|null]>}
 */
export function getDcHealth(_game, msgId) {
  return dcHealthState.get(msgId);
}

/**
 * Set the health state array for a DC message.
 *
 * @param {object} _game - reserved for Slice 2+ (will also write to game.dcList[i])
 * @param {string} msgId
 * @param {Array<[number|null, number|null]>} healthArr
 */
export function setDcHealth(_game, msgId, healthArr) {
  dcHealthState.set(msgId, healthArr);
}
