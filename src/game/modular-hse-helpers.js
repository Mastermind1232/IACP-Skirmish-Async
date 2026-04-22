/**
 * Pure helpers for Heavy Stormtrooper (Elite)'s **Modular**.
 *
 * Card text: "You may include an attachment at -1 cost."
 *
 * Army-building rule. Only one attachment benefits from the discount
 * (the rule text is "an attachment", singular). If the army has HSE
 * and zero attachments, no discount applies.
 *
 * Extracted from src/game/validation.js (inlined at validateDeckLegal
 * line 250 + validateArmyAffiliation line 615) so the discount math is
 * covered by an explicit probe.
 */

// Duplicated locally (rather than imported from validation.js) to avoid a
// circular import — validation.js imports this module for modularDiscountDelta.
function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry?.dcName || entry?.displayName) : entry;
}

export const MODULAR_HSE_NAME = 'Heavy Stormtrooper (Elite)';
export const MODULAR_DISCOUNT = 1;

/**
 * Does the squad trigger the Modular discount?
 * Conditions:
 *   - Army contains Heavy Stormtrooper (Elite)
 *   - Army contains at least one attachment DC
 */
export function modularDiscountApplies(dcList, dcEffects) {
  if (!Array.isArray(dcList) || dcList.length === 0) return false;
  const hasHSE = dcList.some((e) => resolveDcName(e) === MODULAR_HSE_NAME);
  if (!hasHSE) return false;
  return dcList.some((e) => {
    const n = resolveDcName(e);
    const s = dcEffects?.[n] || dcEffects?.[`[${n}]`];
    return !!s?.attachment;
  });
}

/**
 * Returns the numeric delta to subtract from the army's total DC cost
 * when Modular applies. 0 when not applicable, MODULAR_DISCOUNT (1)
 * when applicable. Never doubles even if multiple attachments exist.
 */
export function modularDiscountDelta(dcList, dcEffects) {
  return modularDiscountApplies(dcList, dcEffects) ? MODULAR_DISCOUNT : 0;
}
