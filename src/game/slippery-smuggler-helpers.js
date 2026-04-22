/**
 * Pure helpers for Alliance Smuggler (Elite/Regular)'s **Slippery**.
 *
 * Card text: "While defending, apply -2 Accuracy to the attack
 *  results."
 *
 * Always-on defensive passive, no gate. -2 Accuracy is a flat
 * subtraction from the attacker's accuracy after the roll, which
 * can drop the effective range below the attack's range cost.
 *
 * Extracted from src/handlers/combat.js (Slippery block ~line 2092)
 * so the ID set + bonus shape are pinned by a probe.
 */

export const SLIPPERY_SMUGGLER_ABILITY_IDS = Object.freeze([
  'slippery_smuggler_elite',
  'slippery_smuggler_reg',
]);

export const SLIPPERY_BONUS_ACCURACY = -2;

export function hasSlipperyAbility(specialAbilityIds) {
  if (!Array.isArray(specialAbilityIds)) return false;
  return SLIPPERY_SMUGGLER_ABILITY_IDS.some((id) => specialAbilityIds.includes(id));
}

/**
 * Pure computation of the Slippery accuracy penalty. Always applies
 * when called — caller checks hasSlipperyAbility first.
 */
export function applySlipperyBonus({ bonusAccuracy = 0 } = {}) {
  return {
    applied: true,
    bonusAccuracy: (bonusAccuracy || 0) + SLIPPERY_BONUS_ACCURACY,
  };
}
