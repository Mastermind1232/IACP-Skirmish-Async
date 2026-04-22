/**
 * Pure helpers for **Inspiring** passive.
 *
 * Card text: "While another friendly figure within 3 spaces is
 *  attacking, it may reroll 1 die."
 *
 * Helper owns the predicate, range constant, and reroll math.
 * Adjacency / spatial lookup stays handler-owned.
 *
 * Extracted from src/handlers/combat.js:2767.
 */

export const INSPIRING_ABILITY_ID = 'inspiring';
export const INSPIRING_RANGE = 3;
export const INSPIRING_REROLLS = 1;

export function hasInspiringAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(INSPIRING_ABILITY_ID);
}

/**
 * Add +1 attack-die reroll (stacks). The "first match only" rule
 * (handler breaks after one match) is intentional — the card says
 * "may reroll 1 die", so multiple Inspiring sources do not stack
 * in-engine. This helper is applied at-most-once per attack.
 */
export function applyInspiringReroll({ atkSpecialReroll = 0 } = {}) {
  return {
    applied: true,
    atkSpecialReroll: (atkSpecialReroll || 0) + INSPIRING_REROLLS,
  };
}
