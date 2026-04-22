/**
 * Pure helpers for Echo Base Trooper (Elite)'s **Cortosis Weave**.
 *
 * Card text: "While defending, reduce Pierce by 2."
 *
 * Modeled as a negative bonusPierce delta on pendingCombat. The
 * combat engine elsewhere clamps effective Pierce at min 0, so this
 * helper just does the raw subtraction.
 *
 * Extracted from src/handlers/combat.js:1923.
 */

export const CORTOSIS_WEAVE_ABILITY_ID = 'cortosis_weave';
export const CORTOSIS_WEAVE_PIERCE_DELTA = -2;

export function hasCortosisWeaveAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return specialAbilityIds.includes(CORTOSIS_WEAVE_ABILITY_ID);
}

export function applyCortosisWeave({ bonusPierce = 0 } = {}) {
  return {
    applied: true,
    bonusPierce: (bonusPierce || 0) + CORTOSIS_WEAVE_PIERCE_DELTA,
  };
}
