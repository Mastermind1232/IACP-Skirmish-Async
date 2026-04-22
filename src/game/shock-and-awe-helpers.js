/**
 * Pure helpers for Cara Dune's **Shock and Awe**.
 *
 * Card text: "Once per round, during a Declare Attack step, you
 *  may replace 1 Yellow die with 1 Red die."
 *
 * Helper owns slug id, source + replacement die kinds, per-figure
 * once-per-round key builder, already-used predicate, and the
 * pure die-swap (first Yellow → Red). Round-flag writeback +
 * message render stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1889.
 */

export const SHOCK_AND_AWE_ABILITY_ID = 'shock_and_awe';
export const SHOCK_AND_AWE_SOURCE_DIE = 'yellow';
export const SHOCK_AND_AWE_REPLACEMENT_DIE = 'red';

export function hasShockAndAweAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(SHOCK_AND_AWE_ABILITY_ID);
}

export function buildShockAndAweRoundKey(figureKey) {
  return `${figureKey}_${SHOCK_AND_AWE_ABILITY_ID}`;
}

export function isShockAndAweAlreadyUsed(roundFigureAbilityUsed, key) {
  return Boolean(roundFigureAbilityUsed?.[key]);
}

/**
 * Replace the first Yellow die with a Red die.
 *
 * Returns { applied, dice, replacedIndex }. When no Yellow die
 * exists, returns { applied: false, dice: <same reference> } so
 * the caller skips the message + round-flag write. Never mutates
 * input.
 */
export function applyShockAndAweDieSwap(dice) {
  if (!Array.isArray(dice)) return { applied: false, dice };
  const idx = dice.findIndex(d => d === SHOCK_AND_AWE_SOURCE_DIE);
  if (idx < 0) return { applied: false, dice };
  const newDice = [...dice];
  newDice[idx] = SHOCK_AND_AWE_REPLACEMENT_DIE;
  return { applied: true, dice: newDice, replacedIndex: idx };
}
