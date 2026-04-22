/**
 * Pure helpers for **Cunning** (Han Solo, Jyn Odan, Nexu E/R).
 *
 * Card text: "While defending, apply +1 Block per Evade result."
 *
 * Four slugs share a single-flag flip: setting pendingCombat.
 * hasCunning enables the +1-Block-per-Evade conversion elsewhere
 * in the combat pipeline.
 *
 * Extracted from src/handlers/combat.js:1749.
 */

export const CUNNING_ABILITY_IDS = Object.freeze([
  'cunning_han',
  'cunning_jyn',
  'cunning_nexu_elite',
  'cunning_nexu_reg',
]);

export function hasCunningAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return CUNNING_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

/**
 * Flip the hasCunning flag on pendingCombat. Idempotent — setting it
 * twice has no effect (flag is a boolean).
 */
export function applyCunningFlag({ hasCunning = false } = {}) {
  return {
    applied: true,
    hasCunning: true,
    previouslySet: hasCunning === true,
  };
}
