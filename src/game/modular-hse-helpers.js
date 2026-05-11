/**
 * Pure helpers for Heavy Stormtrooper (Elite)'s **Modular**.
 *
 * Card text: "You may include an attachment card in your army and
 *  decrease its cost by 1, to a minimum of 0. During setup, you must
 *  attach that card to this group."
 *
 * Army-building rule. Per alexanbv 2026-05-10 clarification:
 *   - The discount is PER HSE GROUP — N HSE groups means up to N
 *     attachments can each be discounted by 1.
 *   - Only attachments LEGAL FOR HEAVY STORMTROOPER (ELITE) count
 *     toward the discount pool (i.e. attachments whose printed "X ONLY"
 *     line or keywords admit HSE's TROOPER / HEAVY WEAPON traits).
 *   - Total discount = min(# HSE groups, # legal-for-HSE attachments).
 *   - The "must attach" requirement is left to the player to enforce.
 *   - Auto-attach (when HSE is the only eligible target) is handled by
 *     existing setup code; nothing in this module enforces it.
 */

// Duplicated locally (rather than imported from validation.js) to avoid a
// circular import — validation.js imports this module for modularDiscountDelta.
function resolveDcName(entry) {
  return typeof entry === 'object' ? (entry?.dcName || entry?.displayName) : entry;
}

export const MODULAR_HSE_NAME = 'Heavy Stormtrooper (Elite)';
export const MODULAR_DISCOUNT = 1;

// HSE's own trait set — used to decide which attachments are "legal for
// Heavies." Sourced from data/dc-effects.json keywords ["TROOPER",
// "HEAVY WEAPON"]; hardcoded here to keep this helper pure.
const HSE_KEYWORDS = ['TROOPER', 'HEAVY WEAPON'];

/**
 * Is `attachmentName` (with or without brackets) an attachment whose
 * printed restriction admits Heavy Stormtrooper (Elite)?
 *
 * Order of checks:
 *  1. `keywords` array non-empty — intersection with HSE traits.
 *  2. `abilityText` first line "X ONLY" — substring match of HSE traits.
 *  3. No restriction → legal.
 */
export function isAttachmentLegalForHse(attachmentName, dcEffects) {
  if (!attachmentName || !dcEffects) return false;
  const att = dcEffects[attachmentName] || dcEffects[`[${attachmentName}]`];
  if (!att?.attachment) return false;
  const attKws = (att.keywords || []).map((k) => String(k).toUpperCase());
  if (attKws.length > 0) {
    return attKws.some((k) => HSE_KEYWORDS.includes(k));
  }
  const firstLine = String(att.abilityText || '').split('\n')[0].trim().toUpperCase();
  const onlyMatch = firstLine.match(/^(.+?)\s+ONLY$/);
  if (onlyMatch) {
    const restrictionText = onlyMatch[1];
    return HSE_KEYWORDS.some((k) => restrictionText.includes(k));
  }
  return true;
}

/**
 * Does the squad trigger the Modular discount?
 *  - At least one Heavy Stormtrooper (Elite) group present.
 *  - At least one attachment in the army is legal for HSE.
 */
export function modularDiscountApplies(dcList, dcEffects) {
  if (!Array.isArray(dcList) || dcList.length === 0) return false;
  const hasHSE = dcList.some((e) => resolveDcName(e) === MODULAR_HSE_NAME);
  if (!hasHSE) return false;
  return dcList.some((e) => isAttachmentLegalForHse(resolveDcName(e), dcEffects));
}

/**
 * Returns the numeric delta to subtract from the army's total DC cost.
 * Per group discount: min(# HSE groups, # legal-for-HSE attachments).
 */
export function modularDiscountDelta(dcList, dcEffects) {
  if (!Array.isArray(dcList) || dcList.length === 0) return 0;
  const hseCount = dcList.filter((e) => resolveDcName(e) === MODULAR_HSE_NAME).length;
  if (hseCount === 0) return 0;
  const legalCount = dcList.filter((e) => isAttachmentLegalForHse(resolveDcName(e), dcEffects)).length;
  return Math.min(hseCount, legalCount) * MODULAR_DISCOUNT;
}

/**
 * Returns the list of attachment names (without brackets) currently
 * eligible for Modular's discount, ordered by army-list appearance.
 * Used by validateArmyAffiliation to surface which cards are discounted.
 */
export function modularDiscountedAttachments(dcList, dcEffects) {
  if (!Array.isArray(dcList) || dcList.length === 0) return [];
  const hseCount = dcList.filter((e) => resolveDcName(e) === MODULAR_HSE_NAME).length;
  if (hseCount === 0) return [];
  const legals = dcList
    .map((e) => resolveDcName(e))
    .filter((n) => isAttachmentLegalForHse(n, dcEffects));
  return legals.slice(0, hseCount);
}
