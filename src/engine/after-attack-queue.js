/**
 * After-attack effect queue (CRR step 8 / post-resolve).
 *
 * destruct 2026-05-08: every after-attack effect — Blast, Cleave, Recover,
 * surge-conditions, per-DC after-resolve abilities, and after-resolve CCs
 * (Reduce to Rubble, etc.) — must prompt the attacker (or defender, for
 * defender-side effects) rather than fire automatically. Multiple effects
 * fire in the player's chosen order.
 *
 * This module owns the queue data shape and the trivial mutators. The
 * Discord UI (button-per-pending-effect window) and the per-effect
 * "fire" hooks live in src/handlers/combat.js.
 *
 * An effect entry is an object of shape:
 *   {
 *     id: string,                    // unique within this combat
 *     side: 'attacker' | 'defender', // which side's window owns it
 *     type: string,                  // e.g. 'blast', 'cleave', 'recover',
 *                                    //      'condition', 'stun_batons', etc.
 *     label: string,                 // human-facing button label
 *     payload?: any,                 // type-specific config (e.g. damage, target list)
 *   }
 *
 * Slice 2b first-cut: this module ships unwired so every existing
 * inline auto-apply continues to fire. Subsequent commits wire each
 * source through `enqueueAfterAttackEffect` and replace the inline
 * apply with a button-fired handler. Behind feature flag
 * `game.afterAttackQueueEnabled` (default off) until parity is reached.
 */

let _idCounter = 0;
function _nextId(combat) {
  // Per-combat counter so ids are stable across saves. The leading
  // gameId/combatThreadId disambiguates between concurrent combats.
  combat._aaqIdSeq = (combat._aaqIdSeq || 0) + 1;
  return `aaq_${combat.gameId || 'g'}_${combat._aaqIdSeq}`;
}

/**
 * Push an effect onto the queue. Returns the assigned id so the caller
 * can correlate later (e.g. cancel on cancellation, edit payload).
 *
 * @param {object} combat - pendingCombat object
 * @param {object} effect - { side, type, label, payload? }
 * @returns {string} assigned id
 */
export function enqueueAfterAttackEffect(combat, effect) {
  if (!combat) throw new Error('enqueueAfterAttackEffect: combat required');
  if (!effect || !effect.side || !effect.type || !effect.label) {
    throw new Error('enqueueAfterAttackEffect: effect must have { side, type, label }');
  }
  if (effect.side !== 'attacker' && effect.side !== 'defender') {
    throw new Error(`enqueueAfterAttackEffect: side must be 'attacker' or 'defender' (got ${effect.side})`);
  }
  combat.afterAttackEffects = combat.afterAttackEffects || [];
  const entry = { ...effect, id: effect.id || _nextId(combat) };
  combat.afterAttackEffects.push(entry);
  return entry.id;
}

/**
 * Return all queued effects for a given side, in insertion order.
 * Caller may render these as buttons.
 */
export function getAfterAttackEffects(combat, side) {
  if (!combat || !Array.isArray(combat.afterAttackEffects)) return [];
  return combat.afterAttackEffects.filter((e) => e.side === side);
}

/**
 * Remove an effect by id (after it has fired or been canceled).
 * Returns the removed entry, or null if not found.
 */
export function consumeAfterAttackEffect(combat, id) {
  if (!combat || !Array.isArray(combat.afterAttackEffects)) return null;
  const idx = combat.afterAttackEffects.findIndex((e) => e.id === id);
  if (idx < 0) return null;
  const [entry] = combat.afterAttackEffects.splice(idx, 1);
  return entry;
}

/**
 * True iff the given side has any queued effects pending. The window
 * stays open until this returns false for that side.
 */
export function hasPendingAfterAttackEffects(combat, side) {
  return getAfterAttackEffects(combat, side).length > 0;
}

/**
 * Drain the queue entirely (used at combat close or on full-combat cancel).
 */
export function clearAfterAttackEffects(combat) {
  if (combat) combat.afterAttackEffects = [];
}
