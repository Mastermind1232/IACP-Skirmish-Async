/**
 * Pure helpers for Bib Fortuna's **Illicit Arms**.
 *
 * Card text: "While a friendly figure is attacking, if army
 *  affiliation is Scum, you may discard 1 Command card from your
 *  hand to apply +1 Damage to the attack (once per attack)."
 *
 * Helper owns slug id, required-affiliation ('scum'), +1 Damage bonus,
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

/**
 * True iff the figure carries Illicit Arms (Bib Fortuna) — affiliation
 * agnostic. The Scum restriction belongs to the ARMY, not to Bib the
 * figure (see playerArmyAffiliationIsScum), so presence is checked alone.
 */
export function figureHasIllicitArms(fkEff) {
  return !!fkEff && hasIllicitArmsAbility(fkEff.specialAbilityIds);
}

/**
 * True iff the player's army primary affiliation is Scum. Primary =
 * the most common non-"Any" affiliation across the player's DC list,
 * mirroring validateArmyAffiliation / cc-timing army-affiliation logic.
 * Illicit Arms is usable by ANY friendly figure; the only restriction
 * is that the controlling player's army is Scum-affiliated.
 */
export function playerArmyAffiliationIsScum(dcList, dcEffects) {
  if (!Array.isArray(dcList) || !dcList.length) return false;
  const counts = {};
  for (const dc of dcList) {
    const name = typeof dc === 'object' ? (dc.dcName || dc.displayName) : dc;
    if (!name) continue;
    const aff = String(dcEffects?.[name]?.affiliation || '').toLowerCase();
    if (aff && aff !== 'any') counts[aff] = (counts[aff] || 0) + 1;
  }
  const primary = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  return primary === ILLICIT_ARMS_REQUIRED_AFFILIATION;
}
