/**
 * Pure helpers for **Relentless** (Trandoshan Hunter, IG-88, Fifth Brother).
 *
 * Card text: "When you attack a hostile figure within 3 spaces, that
 *  figure suffers 1 Strain."
 *
 * Helper owns the slug list, range predicate, and strain amount.
 * Target lookup + strain application stay handler-owned.
 *
 * Extracted from src/handlers/combat.js:1815.
 */

export const RELENTLESS_ABILITY_IDS = Object.freeze([
  'relentless_trandoshan_elite',
  'relentless_trandoshan_reg',
  'relentless_ig88',
  'fifth_brother_relentless',
]);

export const RELENTLESS_MAX_DISTANCE = 3;
export const RELENTLESS_STRAIN_AMOUNT = 1;

export function hasRelentlessAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.some(id => RELENTLESS_ABILITY_IDS.includes(id));
}

export function relentlessInRange(distance) {
  return Number.isFinite(distance) && distance <= RELENTLESS_MAX_DISTANCE;
}
