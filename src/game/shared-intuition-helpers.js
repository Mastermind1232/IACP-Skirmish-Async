/**
 * Pure helpers for **Shared Intuition** — carried by 4-LOM only per
 * dc-effects.json (alexanbv correction 2026-05-10; the original file
 * comment misattributed it to Tress Hacnua).
 *
 * Card text: "While attacking, if another friendly HUNTER is
 *  within 3 spaces of you and has LOS to the target, apply +1 Hit
 *  to the attack results."
 *
 * Helper owns slug id, range predicate (distance ≤ 3), required
 * keyword (HUNTER), hit delta (+1), and DC-effect shape predicate.
 * Position iteration, distance counting, and LOS check stay
 * handler-owned.
 *
 * Extracted from src/handlers/combat.js:1931.
 */

export const SHARED_INTUITION_ABILITY_ID = 'shared_intuition';
export const SHARED_INTUITION_MAX_DISTANCE = 3;
export const SHARED_INTUITION_REQUIRED_KEYWORD = 'HUNTER';
export const SHARED_INTUITION_HIT_DELTA = 1;

export function hasSharedIntuitionAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SHARED_INTUITION_ABILITY_ID);
}

export function sharedIntuitionInRange(distance) {
  return Number.isFinite(distance) && distance <= SHARED_INTUITION_MAX_DISTANCE;
}

/** True iff the DC effect has HUNTER in its keywords (case-insensitive). */
export function isHunterFriendly(fkEff) {
  const kws = fkEff?.keywords;
  if (!Array.isArray(kws)) return false;
  return kws.map(k => String(k).toUpperCase()).includes(SHARED_INTUITION_REQUIRED_KEYWORD);
}

export function applySharedIntuitionHit({ bonusHits = 0 } = {}) {
  return {
    applied: true,
    bonusHits: (bonusHits || 0) + SHARED_INTUITION_HIT_DELTA,
  };
}
