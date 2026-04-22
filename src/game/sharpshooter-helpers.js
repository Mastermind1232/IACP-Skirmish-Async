/**
 * Pure helpers for Fennec Shand's **Sharpshooter**.
 *
 * Card text: "While attacking, if the target is 5 or more spaces
 *  away, become Focused."
 *
 * Helper owns slug id, range predicate (distance ≥ 5), and the
 * Focus-with-green-die parameters. Focus application via the
 * shared applyConditionWithDie engine stays handler-owned.
 *
 * Extracted from src/handlers/combat.js:1919.
 */

export const SHARPSHOOTER_ABILITY_ID = 'sharpshooter';
export const SHARPSHOOTER_MIN_DISTANCE = 5;
export const SHARPSHOOTER_CONDITION = 'Focus';
export const SHARPSHOOTER_BONUS_DIE = 'green';

export function hasSharpshooterAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SHARPSHOOTER_ABILITY_ID);
}

export function sharpshooterInRange(distance) {
  return Number.isFinite(distance) && distance >= SHARPSHOOTER_MIN_DISTANCE;
}
