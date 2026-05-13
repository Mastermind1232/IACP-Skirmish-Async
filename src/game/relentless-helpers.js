/**
 * Pure helpers for **Relentless** / **Relentless Pursuit** family
 * (Trandoshan Hunter Elite/Regular, IG-88, Fifth Brother).
 *
 * Card text varies by figure:
 *  - Trandoshan Hunter / IG-88: "When you attack a hostile figure within
 *    3 spaces, that figure suffers 1 Strain." → range-3 gate applies.
 *  - Fifth Brother (Relentless Pursuit): "When you declare an attack,
 *    the target suffers 1 Strain." → **no range gate** (per alexanbv
 *    2026-05-13).
 *
 * Helper owns the slug list, the per-id range predicate, and strain
 * amount. Target lookup + strain application stay handler-owned.
 */

export const RELENTLESS_ABILITY_IDS = Object.freeze([
  'relentless_trandoshan_elite',
  'relentless_trandoshan_reg',
  'relentless_ig88',
  'fifth_brother_relentless',
]);

/** Ability ids whose card text has NO range restriction. */
const RELENTLESS_UNRESTRICTED_IDS = Object.freeze([
  'fifth_brother_relentless',
]);

export const RELENTLESS_MAX_DISTANCE = 3;
export const RELENTLESS_STRAIN_AMOUNT = 1;

export function hasRelentlessAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.some(id => RELENTLESS_ABILITY_IDS.includes(id));
}

/**
 * Returns true iff Relentless can fire at the given distance given the
 * attacker's ability ids. If any of the attacker's relentless ids has no
 * range restriction (e.g. Fifth Brother), the check is unconditional.
 * Otherwise the standard range-3 cap applies.
 */
export function relentlessInRange(distance, specialAbilityIds) {
  if (Array.isArray(specialAbilityIds)
      && specialAbilityIds.some(id => RELENTLESS_UNRESTRICTED_IDS.includes(id))) {
    return true;
  }
  return Number.isFinite(distance) && distance <= RELENTLESS_MAX_DISTANCE;
}
