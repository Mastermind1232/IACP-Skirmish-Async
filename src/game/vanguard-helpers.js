/**
 * Pure helpers for AT-RT's **Vanguard**.
 *
 * Card text: "While attacking, if the target is within 3 spaces,
 *  replace 1 of your attack dice with 1 red die."
 *
 * Helper owns slug id, range predicate (distance ≤ 3), and the
 * pure dice-swap (first non-red die → red). Distance lookup +
 * message render stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1866.
 */

export const VANGUARD_ABILITY_ID = 'vanguard';
export const VANGUARD_MAX_DISTANCE = 3;
export const VANGUARD_REPLACEMENT_DIE = 'red';

export function hasVanguardAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(VANGUARD_ABILITY_ID);
}

export function vanguardInRange(distance) {
  return Number.isFinite(distance) && distance <= VANGUARD_MAX_DISTANCE;
}

/**
 * Replace the first non-red die in the pool with a red die.
 *
 * Returns { applied, dice, replacedKind, replacedIndex }. When no
 * non-red die exists, returns { applied: false, dice: <same
 * reference> } — caller can skip the message. Never mutates input.
 */
export function applyVanguardDieSwap(dice) {
  if (!Array.isArray(dice)) return { applied: false, dice };
  const idx = dice.findIndex(d => d !== VANGUARD_REPLACEMENT_DIE);
  if (idx < 0) return { applied: false, dice };
  const newDice = [...dice];
  const replacedKind = newDice[idx];
  newDice[idx] = VANGUARD_REPLACEMENT_DIE;
  return { applied: true, dice: newDice, replacedKind, replacedIndex: idx };
}
