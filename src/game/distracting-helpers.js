/**
 * Pure helpers for **Distracting** (Han Solo, C-3PO).
 *
 * Card text: "While a friendly figure is defending, and you are
 *  adjacent to the targeted space, apply +1 Evade to the defense
 *  results."
 *
 * Shared +1 Evade bonus across two slugs. Adjacency lookup stays
 * handler-owned. The Rogue Smuggler attachment negation (checked
 * via cardNameIncludes) also stays handler-owned since it depends
 * on per-figure DC attachment lookup.
 *
 * Extracted from src/handlers/combat.js:1755.
 */

export const DISTRACTING_ABILITY_IDS = Object.freeze([
  'distracting_han',
  'distracting_c3po',
]);
export const DISTRACTING_EVADE_DELTA = 1;

export function hasDistractingAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return DISTRACTING_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

export function applyDistractingEvade({ bonusEvade = 0 } = {}) {
  return {
    applied: true,
    bonusEvade: (bonusEvade || 0) + DISTRACTING_EVADE_DELTA,
  };
}
