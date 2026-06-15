// Combined reroll lock — exact rule per alexanbv 2026-06-15:
// "Once a die is rerolled, it may not be further rerolled by anybody
//  (exception: Zeb ability)."
//
// The legacy flow tracked reroll eligibility separately per side
// (attackerRerolledIndices / defenderRerolledIndices), which let a die the
// attacker rerolled still be rerolled by the defender — wrong. This module is
// the single source of truth for the gate rebuild: one combined lock keyed by
// die identity, enforced for BOTH sides, with the Zeb re-turn exemption.
//
// "Die id" is the stable identifier the gate uses for an attack/defense die —
// in the rebuild that is the die's index within its pool, namespaced by pool so
// attack die #0 and defense die #0 never collide. Callers pass a string id
// (e.g. `attack:0`, `defense:1`); helpers below build it from (pool, index).

/** Build the namespaced die id used by the lock. */
export function dieId(pool, index) {
  return `${pool}:${index}`;
}

/** Ensure + return the combined reroll-lock Set on a combat object. */
function lockSet(combat) {
  if (!(combat._rerolledDieIds instanceof Set)) {
    // Rehydrate from a serialized array if present (combat state is persisted).
    combat._rerolledDieIds = new Set(Array.isArray(combat._rerolledDieIds) ? combat._rerolledDieIds : []);
  }
  return combat._rerolledDieIds;
}

/**
 * Has this die already been rerolled (by anybody)?
 * @param {object} combat
 * @param {string} id  namespaced die id (see dieId)
 */
export function isDieRerolled(combat, id) {
  return lockSet(combat).has(id);
}

/**
 * May this die be rerolled right now?
 * False once it has been rerolled by anybody. The special-phase die-TURN
 * abilities (Zeb / Lasat Honor Guard and Rapid Recalibration) are the only
 * exception — they set a face rather than reroll, and run in their own special
 * window, so they bypass the lock. Pass opts.specialTurn for those.
 * @param {object} combat
 * @param {string} id  namespaced die id
 * @param {{specialTurn?: boolean}} [opts]
 */
export function canRerollDie(combat, id, opts = {}) {
  if (opts.specialTurn) return true; // Zeb / Rapid Recalibration die-turn
  return !lockSet(combat).has(id);
}

/**
 * Record that a die was rerolled, locking it from further rerolls. Idempotent.
 * The Zeb re-turn does NOT clear the lock — a Zeb-turned die stays locked to
 * ordinary rerolls.
 * @returns {boolean} true if newly locked, false if it was already locked
 */
export function markDieRerolled(combat, id) {
  const s = lockSet(combat);
  if (s.has(id)) return false;
  s.add(id);
  return true;
}

/** Filter a list of die indices (in one pool) to those still rerollable. */
export function rerollableIndices(combat, pool, indices, opts = {}) {
  return (indices || []).filter((i) => canRerollDie(combat, dieId(pool, i), opts));
}

/** Reset the lock (new attack). Call when a fresh attack/combat begins. */
export function resetRerollLock(combat) {
  combat._rerolledDieIds = new Set();
}

/** Serialize the lock to a plain array (for persistence/checkpoint). */
export function serializeRerollLock(combat) {
  return [...lockSet(combat)];
}
