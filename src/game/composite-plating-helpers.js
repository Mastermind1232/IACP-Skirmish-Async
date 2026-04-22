/**
 * Pure helpers for Heavy Stormtrooper (Regular)'s **Composite Plating**.
 *
 * Card text: "While defending, if the attacker is 4 or more spaces
 *  away, apply +1 Block."
 *
 * Defender passive with distance gate. Extracted from
 * src/handlers/combat.js:1893.
 */

export const COMPOSITE_PLATING_ABILITY_ID = 'composite_plating';
export const COMPOSITE_PLATING_MIN_DISTANCE = 4;
export const COMPOSITE_PLATING_BONUS_BLOCK = 1;

export function hasCompositePlatingAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(COMPOSITE_PLATING_ABILITY_ID);
}

export function compositePlatingApplies(distanceToTarget) {
  if (typeof distanceToTarget !== 'number') return false;
  return distanceToTarget >= COMPOSITE_PLATING_MIN_DISTANCE;
}

export function applyCompositePlatingBonus({ bonusBlock = 0 } = {}) {
  return {
    applied: true,
    bonusBlock: (bonusBlock || 0) + COMPOSITE_PLATING_BONUS_BLOCK,
  };
}
