/**
 * Pure helpers for Echo Base Trooper's **Front Line**.
 *
 * Card text: "While attacking within 3 spaces, replace 1 blue die
 *  with 1 red die."
 *
 * Three decisions:
 *   1) predicate on specialAbilityIds
 *   2) range gate (distanceToTarget ≤ 3)
 *   3) die-swap math (first blue → red, no-op if no blue)
 *
 * Extracted from src/handlers/combat.js:1925.
 */

export const FRONT_LINE_ABILITY_ID = 'front_line';
export const FRONT_LINE_MAX_DISTANCE = 3;

export function hasFrontLineAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(FRONT_LINE_ABILITY_ID);
}

export function frontLineInRange(distanceToTarget) {
  if (typeof distanceToTarget !== 'number') return false;
  return distanceToTarget <= FRONT_LINE_MAX_DISTANCE;
}

/**
 * Given an attack-die pool, swap the first 'blue' entry for 'red'.
 * Pure — returns a new array (or the same reference if no-op).
 *
 * Returns { applied, dice }:
 *   - applied=true  → a swap happened; dice is a new array
 *   - applied=false → no blue die; dice is the original reference
 */
export function applyFrontLineDieSwap(dice) {
  if (!Array.isArray(dice)) return { applied: false, dice: [] };
  const idx = dice.findIndex((d) => d === 'blue');
  if (idx < 0) return { applied: false, dice };
  const next = [...dice];
  next[idx] = 'red';
  return { applied: true, dice: next };
}
