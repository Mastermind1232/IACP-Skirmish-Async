/**
 * Pure helpers for Krrsantan's **Full of Rage**.
 *
 * Card text: "While attacking, if you have suffered 3 or more
 *  damage, become Focused."
 *
 * Helper owns slug id, Focus + green-die parameters, damage gate
 * (≥ 3), and the damage-trigger predicate. The applyConditionWithDie
 * engine call and the early-site "!Focus already" refinement stay
 * handler-owned.
 *
 * Extracted from src/handlers/combat.js:1247 + :1817.
 */

export const FULL_OF_RAGE_ABILITY_ID = 'full_of_rage';
export const FULL_OF_RAGE_CONDITION = 'Focus';
export const FULL_OF_RAGE_BONUS_DIE = 'green';
export const FULL_OF_RAGE_MIN_DAMAGE = 3;

export function hasFullOfRageAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(FULL_OF_RAGE_ABILITY_ID);
}

/** True iff accumulated damage meets the 3-damage trigger. */
export function fullOfRageDamageTriggered(damageSuffered) {
  return Number.isFinite(damageSuffered) && damageSuffered >= FULL_OF_RAGE_MIN_DAMAGE;
}
