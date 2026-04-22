/**
 * Pure helpers for Bib Fortuna's **Illicit Arms**.
 *
 * Card text: "While a friendly figure is attacking, if army
 *  affiliation is Scum, you may discard 1 Command card from your
 *  hand to apply +1 Hit to the attack (once per attack)."
 *
 * Helper owns slug id, required-affiliation ('scum'), +1 Hit bonus,
 * and the per-figure eligibility predicate. Friendly-figure scan,
 * hand lookup, pendingIllicitArms state write, and button UI stay
 * handler-owned.
 *
 * Extracted from src/handlers/combat.js:2487.
 */

export const ILLICIT_ARMS_ABILITY_ID = 'illicit_arms_bib';
export const ILLICIT_ARMS_REQUIRED_AFFILIATION = 'scum';
export const ILLICIT_ARMS_HIT_BONUS = 1;

export function hasIllicitArmsAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(ILLICIT_ARMS_ABILITY_ID);
}

/**
 * True iff the given figure effects block carries Illicit Arms AND
 * the required Scum affiliation (case-insensitive).
 */
export function isIllicitArmsEligibleFigure(fkEff) {
  if (!fkEff) return false;
  if (!hasIllicitArmsAbility(fkEff.specialAbilityIds)) return false;
  const aff = String(fkEff.affiliation || '').toLowerCase();
  return aff === ILLICIT_ARMS_REQUIRED_AFFILIATION;
}
